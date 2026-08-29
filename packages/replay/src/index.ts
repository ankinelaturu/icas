/**
 * @file @icas/replay — deterministic capability execution.
 *
 * Public surface for `icas-play`, MCP, and adapt verification. Callers pass
 * an already-resolved effective capability; this package does not glob the catalog.
 */

export type { ExecutionResult } from "./execution-result.js";
export { ReplayFailureCode } from "./execution-result.js";
export { KNOWN_BUSINESS_OUTCOMES } from "./business-outcomes.js";
export type { ReplayOptions } from "./replay-options.js";
export { ReplayEngine } from "./replay-engine.js";
export type { ReplayEngineDependencies } from "./replay-engine.js";
export type {
  RepairContext,
  RepairProposal,
  RepairProposer,
} from "./repair-proposer.js";
