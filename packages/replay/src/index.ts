/**
 * @file @icas/replay — deterministic capability execution.
 *
 * Public surface for `icas-play`, MCP, and adapt verification. Callers pass
 * an already-resolved effective capability; this package does not glob the catalog.
 */

export type { ExecutionResult } from "./execution-result.js";
export { ReplayFailureCode } from "./execution-result.js";
export type { ReplayOptions } from "./replay-options.js";
export { ReplayEngine } from "./replay-engine.js";
export type { ReplayEngineDependencies } from "./replay-engine.js";
export type {
  MatchedPossibleOutcome,
  OutcomeMatchContext,
  OutcomeMatcher,
} from "./outcome-matcher.js";
export { runOutcomeMatchers } from "./outcome-matcher.js";
export { DEFAULT_OUTCOME_MATCHERS } from "./default-outcome-matchers.js";
export { SubstringOutcomeMatcher } from "./substring-outcome-matcher.js";
export { EmbeddingOutcomeMatcher } from "./embedding-outcome-matcher.js";
export type {
  RepairContext,
  RepairProposal,
  RepairProposer,
} from "./repair-proposer.js";
export type { GuardedReplayReport } from "./guarded-replay.js";
export { classifyGuardedReplay } from "./guarded-replay.js";
