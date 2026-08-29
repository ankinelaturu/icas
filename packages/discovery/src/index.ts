/**
 * @file @icas/discovery — LLM-driven discovery, bounded DFS, trace, and compiler.
 *
 * Model output is {@link CandidateProposal}, never free-form prose. Search
 * state stays in ICAS; Mastra is wired in a later pass as the proposer only.
 */

import type { CapabilityArtifact } from "@icas/capability";
import type { Surface } from "@icas/surface";

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
export type { SearchBudget, SearchNode } from "./search-state.js";
export {
  createSearchNode,
  DEFAULT_SEARCH_BUDGET,
  resolveSearchBudget,
  stateIdFromObservation,
} from "./search-state.js";

export interface DiscoveryTarget {
  vendor: string;
  product: string;
  tenant: string;
  url: string;
}

export interface DiscoveryRequest {
  /** Unique catalog id, e.g. `loan-payoff`. */
  id: string;
  target: DiscoveryTarget;
  goal: string;
  maxSteps?: number;
  maxDepth?: number;
  maxCandidatesPerState?: number;
  timeoutMs?: number;
}

export interface DiscoveryResult {
  status: "success" | "stuck" | "failed";
  capability?: CapabilityArtifact;
  runId: string;
  reason?: string;
}

export class DiscoveryAgent {
  constructor(private readonly surface: Surface) {}

  async run(_request: DiscoveryRequest): Promise<DiscoveryResult> {
    throw new Error("DiscoveryAgent.run is a scaffold. Implement Mastra + bounded UI search here.");
  }
}

export class CapabilityCompiler {
  async compile(_tracePath: string): Promise<CapabilityArtifact> {
    throw new Error("CapabilityCompiler.compile is a scaffold.");
  }
}
