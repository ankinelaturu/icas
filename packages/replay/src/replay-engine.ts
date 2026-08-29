/**
 * @file ReplayEngine — deterministic execution of an already-resolved capability.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction, CapabilityArtifact, CapabilityStep } from "@icas/capability";
import type { EvidenceWriter } from "@icas/evidence";
import type { PolicyGuard } from "@icas/policy";
import type { Surface } from "@icas/surface";

import { KNOWN_BUSINESS_OUTCOMES } from "./business-outcomes.js";
import {
  ReplayFailureCode,
  type ExecutionResult,
} from "./execution-result.js";
import { extractOutputs, isExecutionResult } from "./extract-outputs.js";
import { hydrateAction, hydrateAssertion } from "./hydrate.js";
import { INTERSTITIAL_CONTINUE, INTERSTITIAL_TEXTS } from "./recoverable.js";
import type { ReplayOptions } from "./replay-options.js";
import { hasSurfaceCode } from "./surface-code.js";

/**
 * Optional collaborators. Policy is required for a safe production run.
 */
export interface ReplayEngineDependencies {
  policy?: PolicyGuard;
  evidence?: EvidenceWriter;
}

/**
 * Execute a supplied effective capability. Callers resolve tenant overrides first.
 * This engine never branches on tenant identity.
 */
export class ReplayEngine {
  private readonly policy: PolicyGuard | undefined;
  private readonly evidence: EvidenceWriter | undefined;
  private maxAttempts = 2;

  constructor(
    private readonly surface: Surface,
    deps: ReplayEngineDependencies = {},
  ) {
    this.policy = deps.policy;
    this.evidence = deps.evidence;
  }

  /**
   * Iterate capability steps and return a structured result.
   *
   * Step execute is gated by PolicyGuard. Postconditions are wired later.
   *
   * @param capability - Effective artifact from {@link CapabilityResolver}, or missing
   * @param inputs - Typed invocation parameters used to hydrate assertion ValueRefs
   * @param options - Replay flags such as `assist` (unused until later passes)
   */
  async run(
    capability: CapabilityArtifact | undefined,
    inputs: Record<string, unknown>,
    options: ReplayOptions = {},
  ): Promise<ExecutionResult> {
    const runId = options.runId ?? randomUUID();
    this.maxAttempts = options.maxRetries ?? 2;
    if (capability === undefined) {
      return {
        status: "failure",
        capabilityId: "unknown",
        code: ReplayFailureCode.missingCapability,
        runId,
      };
    }
    for (const step of capability.steps) {
      const preFailure = await this.evaluatePreconditions(step, inputs, runId, capability.id);
      if (preFailure !== undefined) {
        return preFailure;
      }
      const blocked = await this.executeStep(step, inputs, runId, capability.id);
      if (blocked !== undefined) {
        return blocked;
      }
    }
    return await this.finishRun(capability, inputs, runId);
  }

  private async finishRun(
    capability: CapabilityArtifact,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<ExecutionResult> {
    for (const assertion of capability.success) {
      const expected = hydrateAssertion(assertion, inputs);
      const ok = await this.surface.assert(expected);
      if (!ok) {
        return {
          status: "failure",
          capabilityId: capability.id,
          code: ReplayFailureCode.unexpectedState,
          expected,
          observed: false,
          runId,
        };
      }
    }
    const extracted = await extractOutputs({
      surface: this.surface,
      capability,
      runId,
      ...(this.policy === undefined ? {} : { policy: this.policy }),
    });
    if (isExecutionResult(extracted)) {
      return extracted;
    }
    return {
      status: "success",
      capabilityId: capability.id,
      outputs: extracted.outputs,
      runId,
    };
  }

  /**
   * Evaluate one step's checkpoints. Wired in a later pass.
   */
  async verifyStep(_step: CapabilityStep): Promise<void> {
    throw new Error("ReplayEngine.verifyStep is a scaffold.");
  }

  private async evaluatePreconditions(
    step: CapabilityStep,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let failed: ReturnType<typeof hydrateAssertion> | undefined;
      for (const assertion of step.preconditions) {
        const expected = hydrateAssertion(assertion, inputs);
        if (!(await this.surface.assert(expected))) {
          failed = expected;
          break;
        }
      }
      if (failed === undefined) {
        return undefined;
      }
      if (attempt < this.maxAttempts && (await this.recoverInterstitial(runId, attempt))) {
        continue;
      }
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.preconditionFailed,
        stepId: step.id,
        expected: failed,
        observed: false,
        runId,
      };
    }
    return undefined;
  }

  private async executeStep(
    step: CapabilityStep,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    const action = hydrateAction(step.action, inputs);
    const destinationUrl = await this.peekDestination(action);
    const decision = this.policy?.check(action, destinationUrl === undefined
      ? {}
      : { destinationUrl }) ?? { decision: "allow" as const };
    if (decision.decision !== "allow") {
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.policyBlocked,
        stepId: step.id,
        expected: action,
        observed: decision,
        runId,
      };
    }
    try {
      const result = await this.surface.execute(action);
      if (result.status !== "ok") {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.targetNotFound,
          stepId: step.id,
          expected: action,
          observed: result,
          runId,
        };
      }
    } catch (error) {
      if (hasSurfaceCode(error, ReplayFailureCode.targetNotFound)) {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.targetNotFound,
          stepId: step.id,
          expected: action,
          observed: error instanceof Error ? error.message : error,
          runId,
        };
      }
      throw error;
    }
    return await this.evaluatePostconditions(step, inputs, runId, capabilityId);
  }

  private async evaluatePostconditions(
    step: CapabilityStep,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let failed: ReturnType<typeof hydrateAssertion> | undefined;
      for (const assertion of step.postconditions) {
        const expected = hydrateAssertion(assertion, inputs);
        if (!(await this.surface.assert(expected))) {
          failed = expected;
          break;
        }
      }
      if (failed === undefined) {
        return undefined;
      }
      if (attempt < this.maxAttempts && (await this.recoverInterstitial(runId, attempt))) {
        continue;
      }
      const outcome = await this.classifyBusinessOutcome(capabilityId, runId);
      if (outcome !== undefined) {
        return outcome;
      }
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.postconditionFailed,
        stepId: step.id,
        expected: failed,
        observed: false,
        runId,
      };
    }
    return undefined;
  }

  private async recoverInterstitial(runId: string, attempt: number): Promise<boolean> {
    for (const text of INTERSTITIAL_TEXTS) {
      const visible = await this.surface.assert({ type: "textVisible", value: text });
      if (!visible) {
        continue;
      }
      const decision = this.policy?.check(INTERSTITIAL_CONTINUE) ?? { decision: "allow" as const };
      if (decision.decision !== "allow") {
        return false;
      }
      await this.surface.execute(INTERSTITIAL_CONTINUE);
      await this.evidence?.append({
        timestamp: new Date().toISOString(),
        runId,
        runType: "replay",
        type: "recovery",
        actor: "replay",
        payload: { reason: "known_interstitial", text, attempt },
      });
      return true;
    }
    return false;
  }

  private async classifyBusinessOutcome(
    capabilityId: string,
    runId: string,
  ): Promise<ExecutionResult | undefined> {
    for (const known of KNOWN_BUSINESS_OUTCOMES) {
      const visible = await this.surface.assert({
        type: "textVisible",
        value: known.text,
      });
      if (visible) {
        return {
          status: "business_outcome",
          capabilityId,
          outcome: known.outcome,
          details: { text: known.text },
          runId,
        };
      }
    }
    return undefined;
  }

  private async peekDestination(
    action: CapabilityAction,
  ): Promise<string | undefined> {
    if (!("target" in action)) {
      return undefined;
    }
    try {
      return await this.surface.peekDestination(action.target);
    } catch {
      return undefined;
    }
  }
}
