/**
 * @file extract-outputs — read declared capability outputs from the surface.
 */

import {
  CapabilityTypeError,
  validateOutputValues,
  type CapabilityArtifact,
} from "@icas/capability";
import type { PolicyGuard } from "@icas/policy";
import type { Surface } from "@icas/surface";

import { ReplayFailureCode, type ExecutionResult } from "./execution-result.js";

/**
 * Extract and type-check declared outputs via `read` actions.
 *
 * @returns Outputs on success, or a structured extraction/policy failure
 */
export async function extractOutputs(args: {
  surface: Surface;
  capability: CapabilityArtifact;
  runId: string;
  policy?: PolicyGuard;
}): Promise<{ outputs: Record<string, unknown> } | ExecutionResult> {
  const { surface, capability, runId, policy } = args;
  const outputs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(capability.outputs)) {
    const target = spec.extract?.target;
    if (target === undefined) {
      return fail(capability.id, runId, { output: name }, "missing extract.target");
    }
    const action = { type: "read" as const, target };
    const decision = policy?.check(action) ?? { decision: "allow" as const };
    if (decision.decision !== "allow") {
      return {
        status: "failure",
        capabilityId: capability.id,
        code: ReplayFailureCode.policyBlocked,
        expected: action,
        observed: decision,
        runId,
      };
    }
    try {
      const result = await surface.execute(action);
      const value = readValue(result.details);
      if (result.status !== "ok" || value === undefined) {
        return fail(capability.id, runId, { output: name }, result.details);
      }
      outputs[name] = value;
    } catch (error) {
      return fail(
        capability.id,
        runId,
        { output: name },
        error instanceof Error ? error.message : error,
      );
    }
  }
  try {
    validateOutputValues(capability.outputs, outputs);
  } catch (error) {
    return fail(
      capability.id,
      runId,
      "declared outputs",
      error instanceof CapabilityTypeError ? error.message : error,
    );
  }
  return { outputs };
}

function readValue(details: unknown): unknown {
  if (typeof details === "object" && details !== null && "value" in details) {
    return (details as { value: unknown }).value;
  }
  return undefined;
}

function fail(
  capabilityId: string,
  runId: string,
  expected: unknown,
  observed: unknown,
): ExecutionResult {
  return {
    status: "failure",
    capabilityId,
    code: ReplayFailureCode.outputExtractionFailed,
    expected,
    observed,
    runId,
  };
}

function isExecutionResult(
  value: { outputs: Record<string, unknown> } | ExecutionResult,
): value is ExecutionResult {
  return "status" in value;
}

export { isExecutionResult };
