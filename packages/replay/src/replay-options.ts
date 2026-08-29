/**
 * @file ReplayOptions — flags for a single ReplayEngine.run invocation.
 */

export interface ReplayOptions {
  /** When true, a later pass may attempt one bounded LLM repair. */
  assist?: boolean;
  /** Bounded retries for recoverable waits. Unused until a later pass. */
  maxRetries?: number;
  /** Stable id for tests; generated when omitted. */
  runId?: string;
}
