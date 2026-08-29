/**
 * @file Search state and budgets — ICAS-owned DFS nodes, not Mastra memory.
 */

import type { Observation } from "@icas/surface";

import type { CandidateAction } from "./candidate-action.js";

/**
 * Hard limits for one discovery run. Enforcement is wired in later passes.
 */
export interface SearchBudget {
  /** Max Surface.execute calls (total actions). */
  maxSteps: number;
  /** Max DFS depth from the entry observation. */
  maxDepth: number;
  /** Cap on candidates stored on one node after ranking. */
  maxCandidatesPerState: number;
  /** Wall-clock budget for the whole run, in milliseconds. */
  timeoutMs: number;
}

/**
 * Defaults tuned for a small synthetic tenant, not a generic crawler.
 */
export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  maxSteps: 40,
  maxDepth: 20,
  maxCandidatesPerState: 5,
  timeoutMs: 120_000,
};

/**
 * One vertex in confidence-ordered DFS.
 *
 * `triedCandidateIds` records which ranked siblings have already been expanded
 * so a repeated observation does not retry the same dead-end.
 */
export interface SearchNode {
  stateId: string;
  observation: Observation;
  candidates: CandidateAction[];
  triedCandidateIds: Set<string>;
  parent: SearchNode | undefined;
  depth: number;
}

/**
 * Coerce request fields to finite numbers and fill defaults.
 */
export function resolveSearchBudget(
  partial: Partial<SearchBudget> = {},
): SearchBudget {
  return {
    maxSteps: asPositiveInt(partial.maxSteps, DEFAULT_SEARCH_BUDGET.maxSteps),
    maxDepth: asPositiveInt(partial.maxDepth, DEFAULT_SEARCH_BUDGET.maxDepth),
    maxCandidatesPerState: asPositiveInt(
      partial.maxCandidatesPerState,
      DEFAULT_SEARCH_BUDGET.maxCandidatesPerState,
    ),
    timeoutMs: asPositiveInt(partial.timeoutMs, DEFAULT_SEARCH_BUDGET.timeoutMs),
  };
}

/**
 * Identity used for repeated-state detection. URL first; else observation id.
 */
export function stateIdFromObservation(observation: Observation): string {
  if (observation.url !== undefined && observation.url.length > 0) {
    return observation.url;
  }
  return observation.id;
}

/**
 * Allocate a DFS node. Candidates are filled after the proposer returns.
 */
export function createSearchNode(args: {
  observation: Observation;
  parent?: SearchNode;
  candidates?: CandidateAction[];
}): SearchNode {
  const depth = args.parent === undefined ? 0 : args.parent.depth + 1;
  return {
    stateId: stateIdFromObservation(args.observation),
    observation: args.observation,
    candidates: args.candidates ?? [],
    triedCandidateIds: new Set(),
    parent: args.parent,
    depth,
  };
}

function asPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
