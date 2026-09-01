/**
 * @file Mastra-backed RepairProposer for `icas-play run --assist`.
 *
 * Lives in the app so `@icas/replay` stays model-free. ReplayEngine still
 * policy-checks, budgets, and requires path rejoin. This adapter only returns
 * {@link RepairProposal} — it never clicks.
 */

import { Agent } from "@mastra/core/agent";
import {
  CapabilityActionSchema,
  llmActionToCapabilityAction,
  LlmCapabilityActionSchema,
} from "@icas/capability";
import {
  DEFAULT_ICAS_LLM_MODEL,
  isIcasLlmReady,
  resolveIcasLlmSettings,
  toMastraModelConfig,
  toMastraModelSettings,
  type IcasLlmSettings,
} from "@icas/discovery";
import { loadPromptPolicy } from "@icas/policy";
import type { RepairContext, RepairProposal, RepairProposer } from "@icas/replay";
import { z } from "zod";

/** Default model id. Override with `ICAS_ASSIST_LLM_MODEL`. */
export const DEFAULT_REPAIR_MODEL = DEFAULT_ICAS_LLM_MODEL;

/** Stable Mastra agent id. Repair is not discovery DFS. */
export const REPAIR_PROPOSER_AGENT_ID = "icas-repair-proposer";

/**
 * Catalog-shaped repair. Used after mapping; not sent to OpenAI (has `oneOf`).
 */
export const RepairProposalSchema = z.strictObject({
  actions: z.array(CapabilityActionSchema).min(1),
  rationale: z.string().min(1),
});

/**
 * Structured output for Mastra `generate`. Flat actions: OpenAI rejects `oneOf`.
 */
export const LlmRepairProposalSchema = z.strictObject({
  actions: z.array(LlmCapabilityActionSchema).min(1),
  rationale: z.string().min(1),
});

/** Contract text for Mastra `instructions`. */
export const REPAIR_PROPOSER_INSTRUCTIONS = `You repair ONE failed replay step on a bank or credit union staff back-office UI. This is not consumer or retail online banking.

Return ONLY a JSON object:
- actions: 1..N semantic actions (click, fill, select, navigate, read, handoff)
- rationale: why these actions recover the failed step

This is not rediscovery. Stay on the original capability path. Do not invent a new goal.
Do not execute actions. The runtime will policy-check them and require the original postconditions.`;

/**
 * Mastra `Agent.generate` surface used by the adapter. Tests mock this.
 */
export interface StructuredRepairAgent {
  generate(
    messages: string,
    options: {
      structuredOutput: { schema: typeof LlmRepairProposalSchema };
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
 * Resolve the assist `provider/model` id.
 *
 * @param env - Process env; inject in tests
 */
export function resolveRepairModel(env: NodeJS.ProcessEnv = process.env): string {
  return resolveIcasLlmSettings("assist", env).model;
}

/**
 * True when `--assist` can call a live model.
 *
 * Uses resolved `ICAS_ASSIST_LLM_*` (plus legacy fallback), not a hardcoded
 * `OPENAI_API_KEY` check.
 *
 * @param env - Process env
 */
export function hasRepairApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return isIcasLlmReady(resolveIcasLlmSettings("assist", env));
}

/**
 * Build the Mastra Agent used as the repair proposer.
 *
 * No tools are registered: the model ranks replacements; ReplayEngine executes.
 *
 * @param args.instructions - Prompt-policy markdown plus {@link REPAIR_PROPOSER_INSTRUCTIONS}
 * @param args.model - From {@link toMastraModelConfig}
 */
export function createRepairProposerAgent(args: {
  instructions: string;
  model: string | { id: `${string}/${string}`; apiKey?: string; url?: string };
}): Agent {
  return new Agent({
    id: REPAIR_PROPOSER_AGENT_ID,
    name: "ICAS Repair Proposer",
    instructions: args.instructions,
    model: args.model,
  });
}

/**
 * One `generate` per failed step. Validates {@link RepairProposal} before return.
 */
export class MastraRepairProposer implements RepairProposer {
  private readonly modelSettings: ReturnType<typeof toMastraModelSettings>;

  constructor(
    private readonly agent: StructuredRepairAgent,
    options: { settings?: IcasLlmSettings } = {},
  ) {
    this.modelSettings =
      options.settings === undefined ? {} : toMastraModelSettings(options.settings);
  }

  /**
   * Ask Mastra once for replacement actions for `context.step` only.
   *
   * @param context - Frozen failure from ReplayEngine
   * @returns Typed repair
   * @throws {Error} When `result.object` is not a RepairProposal
   */
  async propose(context: RepairContext): Promise<RepairProposal> {
    const result = await this.agent.generate(formatRepairPrompt(context), {
      structuredOutput: { schema: LlmRepairProposalSchema },
      ...(Object.keys(this.modelSettings).length === 0
        ? {}
        : { modelSettings: this.modelSettings }),
    });
    const parsed = LlmRepairProposalSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new Error(`repair proposer returned an invalid RepairProposal: ${parsed.error.message}`);
    }
    return {
      actions: parsed.data.actions.map(llmActionToCapabilityAction),
      rationale: parsed.data.rationale,
    };
  }
}

/**
 * User message for one assist attempt.
 *
 * @param context - Frozen step, capability, failure, and observation
 */
export function formatRepairPrompt(context: RepairContext): string {
  return `Failed step: ${context.step.id}
Failure code: ${context.failure.code}
Expected: ${JSON.stringify(context.failure.expected)}
Observed: ${JSON.stringify(context.failure.observed)}
Capability id: ${context.capability.id}
Observation id: ${context.observation.id}
Observation url: ${context.observation.url ?? "(unknown)"}
Image: ${context.observation.imagePath ?? "(none)"}

Original step action: ${JSON.stringify(context.step.action)}
Original postconditions: ${JSON.stringify(context.step.postconditions)}

Respond with a RepairProposal object.`;
}

/**
 * Production repair proposer: packaged prompt policy + Mastra model router.
 *
 * Does not call the network until {@link MastraRepairProposer.propose}.
 *
 * @param args.promptPolicy - Inline markdown; skips {@link loadPromptPolicy} when set
 * @param args.model - Override model id (tests)
 * @param args.env - Process env for `ICAS_ASSIST_LLM_*`
 */
export async function createConfiguredRepairProposer(args: {
  promptPolicy?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<{
  proposer: MastraRepairProposer;
  model: string;
}> {
  const policyText = args.promptPolicy ?? (await loadPromptPolicy());
  const settings = resolveIcasLlmSettings("assist", args.env ?? process.env);
  const modelId = args.model ?? settings.model;
  const effective: IcasLlmSettings = { ...settings, model: modelId };
  const instructions = `${policyText}\n\n${REPAIR_PROPOSER_INSTRUCTIONS}`;
  const agent = createRepairProposerAgent({
    instructions,
    model: toMastraModelConfig(effective),
  });
  return {
    proposer: new MastraRepairProposer(agent, { settings: effective }),
    model: modelId,
  };
}
