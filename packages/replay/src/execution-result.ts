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
} as const;
