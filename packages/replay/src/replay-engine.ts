/**
 * @file ReplayEngine — deterministic execution of an already-resolved capability.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityArtifact, CapabilityStep } from "@icas/capability";
import type { Surface } from "@icas/surface";

import {
  ReplayFailureCode,
  type ExecutionResult,
} from "./execution-result.js";
import type { ReplayOptions } from "./replay-options.js";

/**
 * Execute a supplied effective capability. Callers resolve tenant overrides first.
 * This engine never branches on tenant identity.
 */
export class ReplayEngine {
  constructor(private readonly surface: Surface) {}

  /**
   * Iterate capability steps and return a structured result.
   *
   * Step bodies are stubbed in this pass: preconditions, policy, and execute
   * are wired in later passes.
   *
   * @param capability - Effective artifact from {@link CapabilityResolver}, or missing
   * @param inputs - Typed invocation parameters (unused until execute is wired)
   * @param options - Replay flags such as `assist` (unused until later passes)
   */
  async run(
    capability: CapabilityArtifact | undefined,
    _inputs: Record<string, unknown>,
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
      await this.stubStep(step);
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

  private async stubStep(_step: CapabilityStep): Promise<void> {
    return;
  }
}
