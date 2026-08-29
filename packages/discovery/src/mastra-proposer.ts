/**
 * @file Mastra candidate proposer — LLM/tool layer only.
 *
 * ICAS owns DFS. This adapter calls `Agent.generate` once per search node with
 * `structuredOutput` set to {@link CandidateProposalSchema}. The agent has no
 * click/fill tools and no Mastra Memory graph.
 */

import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";

import {
  CandidateProposalSchema,
  validateCandidateProposal,
  type CandidateProposal,
} from "./candidate-action.js";
import type { CandidateProposer, ProposeContext } from "./candidate-proposer.js";

export const DISCOVERY_PROPOSER_AGENT_ID = "icas-discovery-proposer";

/**
 * Mastra `Agent.generate` surface used by the adapter. Tests mock this.
 */
export interface StructuredGenerateAgent {
  generate(
    messages: string,
    options: {
      structuredOutput: { schema: typeof CandidateProposalSchema };
    },
  ): Promise<{ object: unknown }>;
}

export const DISCOVERY_PROPOSER_INSTRUCTIONS = `You propose the next UI actions for a banking back-office discovery run.

Return ONLY a JSON object matching this contract (never prose):
- status: "continue" | "success" | "stuck"
- candidates: ranked actions (required and non-empty when status is continue)
- rationale: optional string

Each candidate:
- action: click | fill | select | navigate | read | handoff (semantic ICAS actions)
- rationale: why this control
- rank: number, 1 is tried first
- expectation: optional visible text after the action
- risk: optional "safe" | "risky"

status continue: the goal is not done; list 1..N candidates for this screen.
status success: the current observation already satisfies the goal; candidates may be empty.
status stuck: do not improvise; a human must intervene.

Do not execute actions. ICAS will policy-check and run them.`;

/**
 * Build the Mastra Agent used as the discovery proposer.
 *
 * `model` is Mastra model-router form (`openai/gpt-4o`), not an AI SDK object.
 */
export function createDiscoveryProposerAgent(args: {
  instructions: string;
  model: string;
}): Agent {
  return new Agent({
    id: DISCOVERY_PROPOSER_AGENT_ID,
    name: "ICAS Discovery Proposer",
    instructions: args.instructions,
    model: args.model,
  });
}

/**
 * Register the proposer on a Mastra instance so it can use shared logging later.
 * Search nodes are still stored only in {@link DiscoveryAgent}.
 */
export function createDiscoveryMastra(agent: Agent): Mastra {
  return new Mastra({
    agents: { icasDiscoveryProposer: agent },
  });
}

/**
 * One `generate` per observation. Validates {@link CandidateProposal} before return.
 */
export class MastraCandidateProposer implements CandidateProposer {
  constructor(private readonly agent: StructuredGenerateAgent) {}

  async propose(context: ProposeContext): Promise<CandidateProposal> {
    const result = await this.agent.generate(formatProposePrompt(context), {
      structuredOutput: { schema: CandidateProposalSchema },
    });
    return validateCandidateProposal(result.object);
  }
}

/**
 * User message for one DFS node. Screenshot path is text here; vision is Pass 5.5.
 */
export function formatProposePrompt(context: ProposeContext): string {
  const policy =
    context.promptPolicy === undefined || context.promptPolicy.length === 0
      ? ""
      : `Prompt policy:\n${context.promptPolicy}\n\n`;
  const history =
    context.history.length === 0
      ? "(none)"
      : context.history.map((line, index) => `${String(index + 1)}. ${line}`).join("\n");
  return `${policy}Goal: ${context.goal}

Current observation:
- id: ${context.observation.id}
- url: ${context.observation.url ?? "(unknown)"}
- imagePath: ${context.observation.imagePath ?? "(none)"}
- metadata: ${JSON.stringify(context.observation.metadata ?? {})}

Search history (ICAS, not Mastra Memory):
${history}

Respond with a CandidateProposal object.`;
}
