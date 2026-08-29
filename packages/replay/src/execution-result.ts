/**
 * @file ExecutionResult — structured replay outcome contract.
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
 * Failure codes returned by {@link ReplayEngine}. More codes are added in later passes.
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
