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

/** Contract text for Mastra `instructions`. The model ranks; ICAS executes. */
export const DISCOVERY_PROPOSER_INSTRUCTIONS = `You propose the next operator actions on a bank or credit union staff back-office application. These systems are often legacy: server-rendered screens, nested tables, weak or missing labels, no test IDs, and no API. Accomplish the supplied goal the way a staff user would. This is not consumer or retail online banking.

The runtime owns search, execution, backtracking, policy, and the capability artifact. You only rank semantic branches. You do not execute.

Search:
- This is bounded graph search, not a linear one-shot path. Rank 1 is tried first. If that branch dies, the runtime may return to this state and try rank 2.
- Return 1–3 materially different, goal-relevant candidates. Not every clickable control. Not only a single best guess when distinct routes exist.
- Rank by how likely the action advances THIS goal, not by visual prominence, DOM order, or how easy a control is to click.
- Use search history. Do not re-propose a branch history already showed failed, cyclic, or useless.

Return ONLY a JSON object matching this contract (never prose):
- status: "continue" | "success" | "stuck"
- candidates: ranked actions (required and non-empty when status is continue)
- rationale: optional string

Each candidate:
- action: click | fill | select | navigate | read | handoff
- rationale: why this branch advances the goal (intent only; not a locator and not an outcome)
- rank: number, 1 is tried first
- possibleOutcomes: ordered list, may be empty
- risk: optional "safe" | "risky"
- expectation: if the schema requires this key, set it to null. It is not an after-action checkpoint.

status continue: the current observation does not yet contain the requested result, and at least one safe plausible action could advance toward it. Candidates must be non-empty.
status success: ONLY when the CURRENT snapshot already shows the requested result. A related form, a selected record, or a button that would produce the result is NOT success — return continue.
status stuck: no safe plausible action in this snapshot can advance the goal, or a person must operate this session. Uncertainty is not stuck: return continue with ranked alternatives.

Actions:
- Prefer a visible link or button (click) over guessing a navigate path.
- Use navigate only when the observation clearly justifies a path.
- Use read only to extract a specific visible value. The accessibility snapshot is already the page observation.
- Use handoff only when a person must act on this session.

Fill and select:
- Always set proposedInputParam to { name, type, required }. Never null on fill or select.
- name is camelCase. Derive it from the goal and this field. Do not use a preset list of names.
- The same value in the goal uses the same name on every page.
- type is string, number, boolean, date, or money. required is whether a later replay must supply it.
- Click, navigate, read, and handoff set proposedInputParam to null.

possibleOutcomes:
- Guess from the goal, search history, and this snapshot. You have not seen the next screen. Empty is better than invention with no basis.
- kind "success": this action would complete the goal. Replay does not use these when the next control is missing.
- kind "error": the application has already answered; the caller can stop. No person needs this session.
- kind "hitl": automation cannot continue; a person must operate this same session.
- kind is only who can finish the run. Do not emit product codes or a catalog of domain results.
- List more specific outcomes before generic ones.
- match.phrases: 1–3 distinctive multi-word phrases that might appear on a page for that situation. Any one phrase is enough (OR). Alternative wordings of the same situation go in one phrases array. Different situations are different outcomes.
- Do not use a single generic token as a phrase.
- Do not put this screen's click/fill captions into phrases unless that text would uniquely mark a later failure or completion screen.
- heading and summary: short title and body for the calling tool. Null if unused. Replay never searches the page with heading or summary.
- Do not put invocation values (ids, dates, names, amounts typed this run) in phrases, heading, or summary.

Locators (put the caption in the field that matches type):
- Choose locators only from this observation. Do not invent names, roles, routes, or selectors.
- click a visible control with roleText (link/button + name) or visibleText.
- fill/select: prefer type "relative" with text equal to the adjacent field caption. Many screens put the caption in a table cell, not an associated label, so type "label" will not match.
- type "label" only when the snapshot shows a real labelled textbox.
- roleText needs role + text; relative/visibleText need text; label needs label.

Risk: "safe" for reversible navigation, search, and fill of non-destructive fields. "risky" when the action may change business state. Follow the injected policy. Do not work around it.

Do not execute actions. The runtime will policy-check and run them.`;

/**
 * Build the Mastra Agent used as the discovery proposer.
 *
 * `model` is Mastra model-router form (`openai/gpt-4o`) or an
 * `{ id, apiKey, url }` object so a custom key / local base URL is passed
 * through. No tools are registered: the model ranks; ICAS executes.
 *
 * @param args.instructions - Prompt-policy markdown plus {@link DISCOVERY_PROPOSER_INSTRUCTIONS}
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
 * User message for one DFS node. `imagePath` is a filesystem path in this
 * string, not image bytes. Attaching pixels is Pass 5.22.
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

Search history:
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
  const instructions = `${policyText}\n\n${DISCOVERY_PROPOSER_INSTRUCTIONS}`;
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
