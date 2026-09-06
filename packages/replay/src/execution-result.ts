/**
 * @file ExecutionResult — structured replay outcome contract.
 *
 * CLI, MCP, and adapt verification all consume this union. Discriminate on
 * `status` so a domain result is never coerced into a thrown Error.
 */

/**
 * Terminal result of one {@link ReplayEngine.run}.
 *
 * `success` carries typed outputs. `business_outcome` is an expected domain
 * stop from a matched `possibleOutcomes` entry. `failure` is a classified
 * hard stop with enough expected/observed context to debug without a stack dump.
 */
export type ExecutionResult =
  | {
      status: "success";
      capabilityId: string;
      outputs: Record<string, unknown>;
      runId: string;
    }
  | {
      status: "business_outcome";
      capabilityId: string;
      outcome: string;
      details?: unknown;
      runId: string;
    }
  | {
      status: "failure";
      capabilityId: string;
      code: string;
      stepId?: string;
      expected?: unknown;
      observed?: unknown;
      runId: string;
    };

/**
 * Failure codes returned by {@link ReplayEngine}.
 *
 * String constants (not a TS enum) so SurfaceError can share the same
 * `TARGET_NOT_FOUND` token without a package cycle.
 */
export const ReplayFailureCode = {
  missingCapability: "MISSING_CAPABILITY",
  preconditionFailed: "PRECONDITION_FAILED",
  policyBlocked: "POLICY_BLOCKED",
  postconditionFailed: "POSTCONDITION_FAILED",
  targetNotFound: "TARGET_NOT_FOUND",
  unexpectedState: "UNEXPECTED_STATE",
  outputExtractionFailed: "OUTPUT_EXTRACTION_FAILED",
} as const;

/**
 * `observed` when the next step's locator is gone after this step executed.
 *
 * `expected` is that next action. {@link ReplayEngine} names `stepId` as the
 * missing next step so adapt patches Inquire → Look Up, not the fill that
 * already succeeded.
 */
export const NEXT_ACTION_TARGET_MISSING =
  "next action target missing; no possibleOutcomes or generic chrome matched";
