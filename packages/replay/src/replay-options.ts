/**
 * @file ReplayOptions — flags for a single ReplayEngine.run invocation.
 */

export interface ReplayOptions {
  /** When true, a later pass may attempt one bounded LLM repair. */
  assist?: boolean;
  /** Bounded attempts for recoverable waits (default 2). Semantic mismatches do not retry. */
  maxRetries?: number;
  /** Stable id for tests; generated when omitted. */
  runId?: string;
}
