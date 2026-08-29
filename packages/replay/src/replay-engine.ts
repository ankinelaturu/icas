/**
 * @file ReplayEngine — deterministic execution of an already-resolved capability.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction, CapabilityArtifact, CapabilityStep } from "@icas/capability";
import type { PolicyGuard } from "@icas/policy";
import type { Surface } from "@icas/surface";

import {
  ReplayFailureCode,
  type ExecutionResult,
} from "./execution-result.js";
import { hydrateAction, hydrateAssertion } from "./hydrate.js";
import type { ReplayOptions } from "./replay-options.js";
import { hasSurfaceCode } from "./surface-code.js";

/**
 * Optional collaborators. Policy is required for a safe production run.
 */
export interface ReplayEngineDependencies {
  policy?: PolicyGuard;
}

/**
 * Execute a supplied effective capability. Callers resolve tenant overrides first.
 * This engine never branches on tenant identity.
 */
export class ReplayEngine {
  private readonly policy: PolicyGuard | undefined;

  constructor(
    private readonly surface: Surface,
    deps: ReplayEngineDependencies = {},
  ) {
    this.policy = deps.policy;
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
    return {
      status: "success",
      capabilityId: capability.id,
      outputs: {},
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
    for (const assertion of step.preconditions) {
      const expected = hydrateAssertion(assertion, inputs);
      const ok = await this.surface.assert(expected);
      if (!ok) {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.preconditionFailed,
          stepId: step.id,
          expected,
          observed: false,
          runId,
        };
      }
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
    for (const assertion of step.postconditions) {
      const expected = hydrateAssertion(assertion, inputs);
      const ok = await this.surface.assert(expected);
      if (!ok) {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.postconditionFailed,
          stepId: step.id,
          expected,
          observed: false,
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
