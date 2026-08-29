/**
 * @file @icas/replay — deterministic capability execution.
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
