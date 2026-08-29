/**
 * @file extract-outputs — read declared capability outputs from the surface.
 *
 * Extraction is still a Surface action: PolicyGuard sees each `read`. The
 * engine does not guess missing locators or coerce types past the artifact schema.
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
 * Missing `extract.target` is a catalog defect, not a locator miss. Policy
 * denial and schema mismatch both return structured failures so CLI/MCP
 * stay on the {@link ExecutionResult} contract.
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
    // Schema check after all reads so a type mismatch is not confused with
    // a locator miss on a later field.
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

/**
 * Pull `details.value` from a Surface `read` result.
 *
 * PlaywrightSurface stores the control text there. Any other shape is treated
 * as extraction failure rather than guessing a nested field.
 */
function readValue(details: unknown): unknown {
  if (typeof details === "object" && details !== null && "value" in details) {
    return (details as { value: unknown }).value;
  }
  return undefined;
}

/**
 * Wrap an extraction problem as {@link ReplayFailureCode.outputExtractionFailed}.
 */
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

/**
 * Distinguish a structured failure from `{ outputs }` after extraction.
 *
 * Success bags have no `status`. Using `"status" in value` keeps the union
 * honest without a shared discriminant on the happy path.
 */
function isExecutionResult(
  value: { outputs: Record<string, unknown> } | ExecutionResult,
): value is ExecutionResult {
  return "status" in value;
}

export { isExecutionResult };
