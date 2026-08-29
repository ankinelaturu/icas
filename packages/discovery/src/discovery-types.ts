/**
 * @file Discovery request/result types shared by the agent and compiler.
 *
 * The agent searches; the compiler reads `events` (or JSONL) afterward.
 * `DiscoveryResult.capability` is optional because compile is a separate step.
 */

import type { CapabilityArtifact } from "@icas/capability";

/**
 * Surface identity for one discover run. Do not infer these fields from `url`.
 */
export interface DiscoveryTarget {
  vendor: string;
  product: string;
  tenant: string;
  /** Entry URL. Identity fields above are not inferred from this. */
  url: string;
}

/**
 * CLI/API input for {@link DiscoveryAgent.run}. `--id`, `--url`, and `--goal`
 * are required at the CLI; vendor/product/tenant default there to `icas-bank`.
 */
export interface DiscoveryRequest {
  /** Unique catalog id, e.g. `loan-payoff`. */
  id: string;
  target: DiscoveryTarget;
  goal: string;
  /** Override {@link SearchBudget.maxSteps}. */
  maxSteps?: number;
  /** Override {@link SearchBudget.maxDepth}. */
  maxDepth?: number;
  /** Override {@link SearchBudget.maxCandidatesPerState}. */
  maxCandidatesPerState?: number;
  /** Override {@link SearchBudget.timeoutMs}. */
  timeoutMs?: number;
}

/**
 * One append-only trace record. `type` is a {@link DISCOVERY_TRACE_TYPES}
 * string at runtime; kept as `string` here so JSONL round-trips stay loose.
 */
export interface DiscoveryTraceEvent {
  type: string;
  payload?: unknown;
}

/**
 * Outcome of one discovery search. Compile the artifact from `events` via
 * {@link CapabilityCompiler}; do not treat this object as the catalog record.
 */
export interface DiscoveryResult {
  status: "success" | "stuck" | "failed";
  capability?: CapabilityArtifact;
  runId: string;
  reason?: string;
  /** In-memory record of this run. JSONL persistence goes through {@link DiscoveryTrace}. */
  events: DiscoveryTraceEvent[];
}
