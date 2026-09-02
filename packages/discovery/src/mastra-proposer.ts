/**
 * @file Mastra candidate proposer — LLM/tool layer only.
 *
 * ICAS owns DFS and the ranking contract (`proposer-prompt.ts`). This adapter calls `Agent.generate` once per search node with
 * `structuredOutput` set to {@link LlmCandidateProposalSchema} (flat JSON,
 * no `oneOf`). Catalog {@link CandidateProposalSchema} still validates after map.
 * No click/fill tools and no Mastra Memory graph.
 */

import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { loadPromptPolicy } from "@icas/policy";

import type { CandidateProposal } from "./candidate-action.js";
import type { CandidateProposer, ProposeContext } from "./candidate-proposer.js";
import {
  resolveIcasLlmSettings,
  toMastraModelConfig,
  toMastraModelSettings,
  type IcasLlmSettings,
} from "./llm-settings.js";
import {
  LlmCandidateProposalSchema,
  llmProposalToCandidateProposal,
} from "./llm-proposal-schema.js";
import {
  composeDiscoveryProposerInstructions,
  formatProposePrompt,
} from "./proposer-prompt.js";

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
      modelSettings?: {
        temperature?: number;
        topK?: number;
        topP?: number;
        maxOutputTokens?: number;
      };
    },
  ): Promise<{ object: unknown }>;
}

/**
 * Build the Mastra Agent used as the discovery proposer.
 *
 * `model` is Mastra model-router form (`openai/gpt-4o`) or an
 * `{ id, apiKey, url }` object so a custom key / local base URL is passed
 * through. No tools are registered: the model ranks; ICAS executes.
 *
 * @param args.instructions - From {@link composeDiscoveryProposerInstructions}
 * @param args.model - From {@link toMastraModelConfig}
 */
export function createDiscoveryProposerAgent(args: {
  instructions: string;
  model: string | { id: `${string}/${string}`; apiKey?: string; url?: string };
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
  private readonly instructions: string | undefined;
  private readonly modelSettings: ReturnType<typeof toMastraModelSettings>;
  /** Instructions are identical on every generate; print them only once. */
  private loggedInstructions = false;

  /**
   * @param agent - Mastra `generate` (or a test fake)
   * @param options.log - Optional stderr sink for prompt and response
   * @param options.instructions - Agent system text; logged once when `log` is set
   * @param options.settings - Sampling passed through as `modelSettings`
   */
  constructor(
    private readonly agent: StructuredGenerateAgent,
    options: {
      log?: (line: string) => void;
      instructions?: string;
      settings?: IcasLlmSettings;
    } = {},
  ) {
    this.log = options.log;
    this.instructions = options.instructions;
    this.modelSettings =
      options.settings === undefined ? {} : toMastraModelSettings(options.settings);
  }

  /**
   * Ask Mastra once, then schema-validate so free-form prose cannot enter DFS.
   *
   * @param context - Goal, observation, chosen-action history, optional prompt policy
   * @returns Typed proposal
   * @throws {CandidateValidationError} When `result.object` is not a CandidateProposal
   */
  async propose(context: ProposeContext): Promise<CandidateProposal> {
    const userPrompt = formatProposePrompt(context);
    this.logPrompt(context, userPrompt);
    let result: { object: unknown };
    try {
      result = await this.agent.generate(userPrompt, {
        structuredOutput: { schema: LlmCandidateProposalSchema },
        ...(Object.keys(this.modelSettings).length === 0
          ? {}
          : { modelSettings: this.modelSettings }),
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

  /**
   * Print agent instructions (once) and the user message for this node.
   *
   * @param context - Same inputs as {@link formatProposePrompt}
   * @param userPrompt - Exact string passed to `generate`
   */
  private logPrompt(context: ProposeContext, userPrompt: string): void {
    if (this.log === undefined) {
      return;
    }
    this.log(
      `LLM generate observation=${context.observation.id} url=${context.observation.url ?? "(unknown)"}`,
    );
    if (!this.loggedInstructions && this.instructions !== undefined && this.instructions.length > 0) {
      this.loggedInstructions = true;
      this.log(`LLM agent instructions (same on every generate):\n${this.instructions}`);
    }
    this.log(`LLM user prompt:\n${userPrompt}`);
  }
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
 * @param args.model - Override model id (tests); otherwise `ICAS_DISCOVERY_LLM_*`
 * @param args.env - Process env for settings; tests inject a stub
 * @param args.log - Optional stderr sink for raw LLM JSON
 */
export async function createConfiguredDiscoveryProposer(args: {
  promptPolicy?: string;
  promptPolicyPath?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
} = {}): Promise<{
  proposer: MastraCandidateProposer;
  model: string;
  instructions: string;
}> {
  const policyText = args.promptPolicy ?? (await loadPromptPolicy(args.promptPolicyPath));
  const settings = resolveIcasLlmSettings("discovery", args.env ?? process.env);
  const modelId = args.model ?? settings.model;
  const effective: IcasLlmSettings = { ...settings, model: modelId };
  // Safety text lives on the Agent so every generate sees it, not only the user message.
  const instructions = composeDiscoveryProposerInstructions(policyText);
  const agent = createDiscoveryProposerAgent({
    instructions,
    model: toMastraModelConfig(effective),
  });
  return {
    proposer: new MastraCandidateProposer(agent, {
      ...(args.log === undefined ? {} : { log: args.log }),
      instructions,
      settings: effective,
    }),
    model: modelId,
    instructions,
  };
}
