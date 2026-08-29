/**
 * @file ReplayOptions — flags for a single ReplayEngine.run invocation.
 *
 * Strict replay is the default (no LLM). `assist` is an explicit opt-in and
 * still requires an injected {@link RepairProposer}.
 */

/**
 * Per-run knobs. Tenant identity is not a flag — the caller already resolved
 * the effective capability.
 */
export interface ReplayOptions {
  /** When true, one bounded repair may run after a failed step. */
  assist?: boolean;
  /** Max repair actions executed in one assist attempt (default 3). */
  assistBudget?: number;
  /** Bounded attempts for recoverable waits (default 2). Semantic mismatches do not retry. */
  maxRetries?: number;
  /** Stable id for tests; generated when omitted. */
  runId?: string;
}
