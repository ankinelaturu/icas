/**
 * @file Guarded replay classification for icas-adapt.
 *
 * ReplayEngine already stops at the first failed checkpoint. This helper
 * names that stop for adaptation: compatible vs a precise mismatch vs a
 * domain outcome. It does not branch on tenant identity.
 */

import type { ExecutionResult } from "./execution-result.js";

/**
 * Outcome of one guarded replay of a Vendor+Product base against a new URL.
 *
 * `mismatch` carries the failed step so a later pass can patch only that region.
 */
export type GuardedReplayReport =
  | { status: "compatible"; result: Extract<ExecutionResult, { status: "success" }> }
  | {
      status: "mismatch";
      stepId: string;
      expected: unknown;
      observed: unknown;
      result: Extract<ExecutionResult, { status: "failure" }>;
    }
  | {
      status: "business_outcome";
      result: Extract<ExecutionResult, { status: "business_outcome" }>;
    };

/**
 * Classify a ReplayEngine result for adaptation.
 *
 * Compatible means every checkpoint passed. Mismatch is a classified failure
 * with a step id. Missing stepId is treated as mismatch on the capability as
 * a whole so adapt still stops rather than inventing a patch target.
 *
 * @param result - Structured outcome from {@link ReplayEngine.run}
 */
export function classifyGuardedReplay(result: ExecutionResult): GuardedReplayReport {
  if (result.status === "success") {
    return { status: "compatible", result };
  }
  if (result.status === "business_outcome") {
    return { status: "business_outcome", result };
  }
  return {
    status: "mismatch",
    stepId: result.stepId ?? result.capabilityId,
    expected: result.expected,
    observed: result.observed,
    result,
  };
}
