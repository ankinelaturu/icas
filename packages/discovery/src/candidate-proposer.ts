/**
 * @file CandidateProposer — ICAS calls this once per search node.
 *
 * Mastra implements this interface later. The search controller never
 * stores graph state inside the proposer's conversation memory.
 */

import type { Observation } from "@icas/surface";

import type { CandidateProposal } from "./candidate-action.js";

export interface ProposeContext {
  goal: string;
  observation: Observation;
  /** Compact ancestor summary for the prompt, not a Mastra Memory thread. */
  history: string[];
  promptPolicy?: string;
}

/**
 * Produce a schema-shaped {@link CandidateProposal} from the current observation.
 */
export interface CandidateProposer {
  propose(context: ProposeContext): Promise<CandidateProposal>;
}
