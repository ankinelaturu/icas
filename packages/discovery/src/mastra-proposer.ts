/**
 * @file Mastra candidate proposer — LLM/tool layer only.
 *
 * ICAS owns DFS. This adapter calls `Agent.generate` once per search node with
 * `structuredOutput` set to {@link LlmCandidateProposalSchema} (flat JSON,
 * no `oneOf`). Catalog {@link CandidateProposalSchema} still validates after map.
 * click/fill tools and no Mastra Memory graph.
 */

import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { loadPromptPolicy } from "@icas/policy";

import {
  LlmCandidateProposalSchema,
  llmProposalToCandidateProposal,
} from "./llm-proposal-schema.js";
import type { CandidateProposal } from "./candidate-action.js";
import type { CandidateProposer, ProposeContext } from "./candidate-proposer.js";
import { resolveDiscoveryModel } from "./model-provider.js";

/** Stable Mastra agent id. Search identity lives on {@link DiscoveryAgent}, not here. */
export const DISCOVERY_PROPOSER_AGENT_ID = "icas-discovery-proposer";

/**
 * Mastra `Agent.generate` surface used by the adapter. Tests mock this.
 *
 * Production uses a real Mastra `Agent`. The adapter never adds click/fill tools.
 */
export interface StructuredGenerateAgent {
  generate(
    messages: string,
    options: {
      structuredOutput: { schema: typeof LlmCandidateProposalSchema };
    },
  ): Promise<{ object: unknown }>;
}

/** Contract text for Mastra `instructions`. The model ranks; ICAS executes. */
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

Locators (put the caption in the field that matches type):
- click a visible control with roleText (link/button + name) or visibleText. Do not guess a navigate path when a link or button is on the screen.
- fill/select: prefer type "relative" with text equal to the field caption (the adjacent table-cell text such as "LN Acct #"). Core banking screens often have no associated <label>, so type "label" will not match.
- type "label" only when the snapshot shows a real labelled textbox.
- roleText needs role + text; relative/visibleText need text; label needs label.

status continue: the goal is not done; list 1..N candidates for this screen.
status success: the current observation already satisfies the goal; candidates may be empty.
status stuck: do not improvise; a human must intervene.

Do not execute actions. ICAS will policy-check and run them.`;

/**
 * Build the Mastra Agent used as the discovery proposer.
 *
 * `model` is Mastra model-router form (`openai/gpt-4o`), not an AI SDK object.
 * No tools are registered: the model ranks; ICAS executes.
 *
 * @param args.instructions - Prompt-policy markdown plus {@link DISCOVERY_PROPOSER_INSTRUCTIONS}
 * @param args.model - `provider/model` from {@link resolveDiscoveryModel}
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
 *
 * @param agent - Proposer agent from {@link createDiscoveryProposerAgent}
 * @returns A Mastra host; does not start DFS
 */
export function createDiscoveryMastra(agent: Agent): Mastra {
  return new Mastra({
    agents: { icasDiscoveryProposer: agent },
  });
}

/**
 * One `generate` per observation. Validates {@link CandidateProposal} before return.
 *
 * ICAS owns DFS: this class never retries generate, never stores SearchNode state,
 * and never executes the proposed action.
 */
export class MastraCandidateProposer implements CandidateProposer {
  private readonly log: ((line: string) => void) | undefined;

  /**
   * @param agent - Mastra `generate` (or a test fake)
   * @param options.log - Optional stderr sink; prints the raw structured object
   */
  constructor(
    private readonly agent: StructuredGenerateAgent,
    options: { log?: (line: string) => void } = {},
  ) {
    this.log = options.log;
  }

  /**
   * Ask Mastra once, then schema-validate so free-form prose cannot enter DFS.
   *
   * @param context - Goal, observation, chosen-action history, optional prompt policy
   * @returns Typed proposal
   * @throws {CandidateValidationError} When `result.object` is not a CandidateProposal
   */
  async propose(context: ProposeContext): Promise<CandidateProposal> {
    this.log?.(`LLM generate observation=${context.observation.id} url=${context.observation.url ?? "(unknown)"}`);
    let result: { object: unknown };
    try {
      result = await this.agent.generate(formatProposePrompt(context), {
        structuredOutput: { schema: LlmCandidateProposalSchema },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log?.(`LLM generate failed: ${message}`);
      throw error;
    }
    this.log?.(`LLM raw response:\n${JSON.stringify(result.object, null, 2)}`);
    try {
      return llmProposalToCandidateProposal(result.object);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log?.(`LLM response failed catalog mapping: ${message}`);
      throw error;
    }
  }
}

/**
 * User message for one DFS node. Screenshot path is text here; vision is Pass 5.5.
 *
 * Empty prompt policy is omitted so the model does not see a blank header.
 * Empty history renders as `(none)` so the field is still present.
 *
 * @param context - Same object {@link DiscoveryAgent} passes to `propose`
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
- accessibilitySnapshot:
${truncateSnapshot(context.observation.accessibilitySnapshot)}

Search history (ICAS, not Mastra Memory):
${history}

Respond with a CandidateProposal object.`;
}

/** Cap ARIA text so one huge page cannot blow the model context. */
const MAX_SNAPSHOT_CHARS = 8_000;

/**
 * Include the accessibility tree in the prompt. The screenshot path is not
 * pixels; without this snapshot the model is guessing from the URL.
 *
 * @param snapshot - Playwright aria snapshot, if captured
 */
function truncateSnapshot(snapshot: unknown): string {
  const text =
    typeof snapshot === "string"
      ? snapshot
      : snapshot === undefined || snapshot === null
        ? ""
        : JSON.stringify(snapshot);
  if (text.length === 0) {
    return "(none)";
  }
  if (text.length <= MAX_SNAPSHOT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n…(truncated)`;
}

/**
 * Production proposer: packaged prompt policy + Mastra model router.
 *
 * Does not call the network until {@link MastraCandidateProposer.propose}.
 * Policy text is prepended to agent instructions; {@link DiscoveryAgent} may
 * also pass `promptPolicy` per call into the user message.
 *
 * @param args.promptPolicy - Inline markdown; skips {@link loadPromptPolicy} when set
 * @param args.promptPolicyPath - Optional path for {@link loadPromptPolicy}
 * @param args.model - Override {@link resolveDiscoveryModel}
 * @param args.log - Optional stderr sink for raw LLM JSON
 */
export async function createConfiguredDiscoveryProposer(args: {
  promptPolicy?: string;
  promptPolicyPath?: string;
  model?: string;
  log?: (line: string) => void;
} = {}): Promise<{
  proposer: MastraCandidateProposer;
  model: string;
  instructions: string;
}> {
  const policyText = args.promptPolicy ?? (await loadPromptPolicy(args.promptPolicyPath));
  const model = args.model ?? resolveDiscoveryModel();
  // Safety text lives on the Agent so every generate sees it, not only the user message.
  const instructions = `${policyText}\n\n${DISCOVERY_PROPOSER_INSTRUCTIONS}`;
  const agent = createDiscoveryProposerAgent({ instructions, model });
  return {
    proposer: new MastraCandidateProposer(
      agent,
      args.log === undefined ? {} : { log: args.log },
    ),
    model,
    instructions,
  };
}
