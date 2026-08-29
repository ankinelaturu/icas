/**
 * @file ReplayEngine — deterministic execution of an already-resolved capability.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction, CapabilityArtifact, CapabilityStep } from "@icas/capability";
import { ASSISTED_FALLBACK_EVENT, type EvidenceWriter } from "@icas/evidence";
import type { HandoffController } from "@icas/handoff";
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
import type { RepairProposer } from "./repair-proposer.js";
import type { ReplayOptions } from "./replay-options.js";
import { hasSurfaceCode } from "./surface-code.js";

/**
 * Optional collaborators. Policy is required for a safe production run.
 */
export interface ReplayEngineDependencies {
  policy?: PolicyGuard;
  evidence?: EvidenceWriter;
  handoff?: HandoffController;
  repair?: RepairProposer;
}

/**
 * Execute a supplied effective capability. Callers resolve tenant overrides first.
 * This engine never branches on tenant identity.
 */
export class ReplayEngine {
  private readonly policy: PolicyGuard | undefined;
  private readonly evidence: EvidenceWriter | undefined;
  private readonly handoff: HandoffController | undefined;
  private readonly repair: RepairProposer | undefined;
  private maxAttempts = 2;
  private assistBudget = 3;
  private assistEnabled = false;
  private assistUsed = false;
  private currentCapability: CapabilityArtifact | undefined;
  private startedAt = "";

  constructor(
    private readonly surface: Surface,
    deps: ReplayEngineDependencies = {},
  ) {
    this.policy = deps.policy;
    this.evidence = deps.evidence;
    this.handoff = deps.handoff;
    this.repair = deps.repair;
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
    this.assistEnabled = options.assist === true;
    this.assistBudget = options.assistBudget ?? 3;
    this.assistUsed = false;
    this.startedAt = new Date().toISOString();
    const result = await this.runLoop(capability, inputs, runId);
    if (result.status === "failure") {
      await this.captureFailureEvidence(result);
    }
    return result;
  }

  private async runLoop(
    capability: CapabilityArtifact | undefined,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<ExecutionResult> {
    if (capability === undefined) {
      return {
        status: "failure",
        capabilityId: "unknown",
        code: ReplayFailureCode.missingCapability,
        runId,
      };
    }
    this.currentCapability = capability;
    for (let index = 0; index < capability.steps.length; index++) {
      const step = capability.steps[index];
      if (step === undefined) {
        continue;
      }
      const nextStep = capability.steps[index + 1];
      const preFailure = await this.evaluatePreconditions(step, inputs, runId, capability.id);
      if (preFailure !== undefined) {
        return preFailure;
      }
      const blocked = await this.executeStep(step, nextStep, inputs, runId, capability.id);
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
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    const action = hydrateAction(step.action, inputs);
    const destinationUrl = await this.peekDestination(action);
    const decision = this.policy?.check(action, destinationUrl === undefined
      ? {}
      : { destinationUrl }) ?? { decision: "allow" as const };
    if (decision.decision === "require-human") {
      const paused = await this.pauseForHuman({
        runId,
        capabilityId,
        stepId: step.id,
        reason: "approval_required",
        message: decision.reason,
      });
      if (!paused) {
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
    } else if (decision.decision !== "allow") {
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
        return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.unexpectedState,
          stepId: step.id,
          expected: action,
          observed: result,
          runId,
        });
      }
    } catch (error) {
      if (hasSurfaceCode(error, ReplayFailureCode.targetNotFound)) {
        return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.targetNotFound,
          stepId: step.id,
          expected: action,
          observed: error instanceof Error ? error.message : error,
          runId,
        });
      }
      throw error;
    }
    const post = await this.evaluatePostconditions(step, inputs, runId, capabilityId);
    if (post !== undefined) {
      return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, post);
    }
    return undefined;
  }

  private canAssist(): boolean {
    return this.assistEnabled && this.repair !== undefined && !this.assistUsed;
  }

  private async maybeAssist(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
    failure: ExecutionResult,
  ): Promise<ExecutionResult | undefined> {
    if (failure.status !== "failure" || !this.canAssist() || this.repair === undefined) {
      return failure;
    }
    if (this.currentCapability === undefined) {
      return failure;
    }
    this.assistUsed = true;
    const observation = await this.surface.observe();
    const proposal = await this.repair.propose({
      step,
      capability: this.currentCapability,
      failure,
      observation,
    });
    let executed = 0;
    for (const raw of proposal.actions) {
      if (executed >= this.assistBudget) {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.unexpectedState,
          stepId: step.id,
          expected: { budget: this.assistBudget },
          observed: "assist budget exceeded",
          runId,
        };
      }
      const repairAction = hydrateAction(raw, inputs);
      const decision = this.policy?.check(repairAction) ?? { decision: "allow" as const };
      if (decision.decision !== "allow") {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.policyBlocked,
          stepId: step.id,
          expected: repairAction,
          observed: decision,
          runId,
        };
      }
      await this.surface.execute(repairAction);
      executed += 1;
      await this.evidence?.append({
        timestamp: new Date().toISOString(),
        runId,
        runType: "replay",
        type: ASSISTED_FALLBACK_EVENT,
        actor: "agent",
        payload: { action: repairAction, rationale: proposal.rationale },
      });
    }
    const post = await this.evaluatePostconditions(step, inputs, runId, capabilityId);
    if (post !== undefined) {
      return post;
    }
    if (nextStep !== undefined) {
      const pre = await this.evaluatePreconditions(nextStep, inputs, runId, capabilityId);
      if (pre !== undefined) {
        return pre;
      }
    }
    return undefined;
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

  private async pauseForHuman(args: {
    runId: string;
    capabilityId: string;
    stepId: string;
    reason: "approval_required" | "unexpected_state" | "policy_block" | "hard_failure_recovery";
    message: string;
  }): Promise<boolean> {
    if (this.handoff === undefined) {
      return false;
    }
    await this.handoff.request({
      runId: args.runId,
      reason: args.reason,
      message: args.message,
      capabilityId: args.capabilityId,
      stepId: args.stepId,
    });
    await this.surface.handoffToHuman();
    await this.handoff.waitForResume();
    await this.surface.resumeFromHuman();
    return true;
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

  private async captureFailureEvidence(
    result: Extract<ExecutionResult, { status: "failure" }>,
  ): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    const payload: Record<string, unknown> = {
      code: result.code,
      expected: result.expected,
      observed: result.observed,
    };
    if (result.stepId !== undefined) {
      payload.stepId = result.stepId;
    }
    await this.evidence.append({
      timestamp: new Date().toISOString(),
      runId: result.runId,
      runType: "replay",
      type: "failure",
      actor: "replay",
      payload,
    });
    try {
      const observation = await this.surface.observe();
      await this.evidence.captureRichSignal(
        "dom",
        observation.accessibilitySnapshot ?? observation,
      );
      if (observation.imagePath !== undefined) {
        await this.evidence.captureRichSignal("screenshot", observation.imagePath);
      }
    } catch {
      await this.evidence.captureRichSignal("trace", { code: result.code });
    }
    await this.evidence.writeSummary({
      runId: result.runId,
      runType: "replay",
      capabilityId: result.capabilityId,
      status: "failure",
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
}
