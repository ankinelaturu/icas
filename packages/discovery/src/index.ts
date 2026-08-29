/**
 * @file @icas/discovery — LLM-driven discovery, bounded DFS, trace, and compiler.
 *
 * Model output is {@link CandidateProposal}, never free-form prose. Search
 * state stays in ICAS; Mastra proposes structured candidates only.
 */

export type {
  CandidateAction,
  CandidateProposal,
  CapabilityAction,
} from "./candidate-action.js";
export {
  assignCandidateIds,
  CandidateActionSchema,
  CandidateProposalSchema,
  CandidateValidationError,
  sortCandidatesByRank,
  validateCandidateProposal,
} from "./candidate-action.js";
export type { CandidateProposer, ProposeContext } from "./candidate-proposer.js";
export { CapabilityCompiler } from "./capability-compiler.js";
export type { DiscoveryAgentDependencies } from "./discovery-agent.js";
export { DiscoveryAgent } from "./discovery-agent.js";
export {
  createDiscoveryMastra,
  createDiscoveryProposerAgent,
  DISCOVERY_PROPOSER_AGENT_ID,
  DISCOVERY_PROPOSER_INSTRUCTIONS,
  formatProposePrompt,
  MastraCandidateProposer,
} from "./mastra-proposer.js";
export type { StructuredGenerateAgent } from "./mastra-proposer.js";
export type {
  DiscoveryRequest,
  DiscoveryResult,
  DiscoveryTarget,
  DiscoveryTraceEvent,
} from "./discovery-types.js";
export type { SearchBudget, SearchNode } from "./search-state.js";
export {
  createSearchNode,
  DEFAULT_SEARCH_BUDGET,
  resolveSearchBudget,
  stateIdFromObservation,
} from "./search-state.js";
