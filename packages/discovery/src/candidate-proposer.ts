/**
 * @file CandidateProposer — ICAS calls this once per search node.
 *
 * {@link MastraCandidateProposer} implements this in production. Tests inject
 * a fake. The search controller never stores graph state inside the proposer's
 * conversation memory.
 */

import type { Observation } from "@icas/surface";

import type { CandidateProposal } from "./candidate-action.js";

/**
 * Inputs for one proposer call. History is already filtered to chosen actions
 * by {@link DiscoveryAgent} so the model sees the path taken, not failed siblings.
 */
export interface ProposeContext {
  /** Natural-language goal for this discover run. */
  goal: string;
  /** Current surface snapshot; the proposer must not execute against it. */
  observation: Observation;
  /** Compact ancestor summary for the prompt, not a Mastra Memory thread. */
  history: string[];
  /** Packaged prompt-policy markdown, inlined into the user message when set. */
  promptPolicy?: string;
}

/**
 * Produce a schema-shaped {@link CandidateProposal} from the current observation.
 *
 * Implementations must not execute UI actions. ICAS policy-checks and runs them.
 */
export interface CandidateProposer {
  /**
   * Rank candidates, or declare success/stuck, for this observation only.
   *
   * @param context - Goal, current observation, and chosen-action history
   * @returns Validated proposal; callers must not parse free-form prose
   */
  propose(context: ProposeContext): Promise<CandidateProposal>;
}
