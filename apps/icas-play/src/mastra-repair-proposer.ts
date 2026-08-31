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
import { loadPromptPolicy } from "@icas/policy";
import type { RepairContext, RepairProposal, RepairProposer } from "@icas/replay";
import { z } from "zod";

/** Default Mastra model-router id (image-capable). Override with `ICAS_MODEL`. */
export const DEFAULT_REPAIR_MODEL = "openai/gpt-4o";

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
- actions: 1..N semantic ICAS actions (click, fill, select, navigate, read, handoff)
- rationale: why these actions recover the failed step

This is not rediscovery. Stay on the original capability path. Do not invent a new goal.
Do not execute actions. ICAS will policy-check them and require the original postconditions.`;

/**
 * Mastra `Agent.generate` surface used by the adapter. Tests mock this.
 */
export interface StructuredRepairAgent {
  generate(
    messages: string,
    options: {
      structuredOutput: { schema: typeof LlmRepairProposalSchema };
    },
  ): Promise<{ object: unknown }>;
}

/**
 * Resolve the Mastra model id. Does not call the network.
 *
 * @param env - Process env; inject in tests
 */
export function resolveRepairModel(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ICAS_MODEL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  if (
    env.ANTHROPIC_API_KEY !== undefined &&
    env.ANTHROPIC_API_KEY.length > 0 &&
    (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.length === 0)
  ) {
    return "anthropic/claude-sonnet-4-6";
  }
  return DEFAULT_REPAIR_MODEL;
}

/**
 * True when a provider key exists so a live generate could run.
 *
 * @param env - Process env
 */
export function hasRepairApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const openai = env.OPENAI_API_KEY;
  const anthropic = env.ANTHROPIC_API_KEY;
  return (
    (openai !== undefined && openai.length > 0) ||
    (anthropic !== undefined && anthropic.length > 0)
  );
}

/**
 * Build the Mastra Agent used as the repair proposer.
 *
 * No tools are registered: the model ranks replacements; ReplayEngine executes.
 *
 * @param args.instructions - Prompt-policy markdown plus {@link REPAIR_PROPOSER_INSTRUCTIONS}
 * @param args.model - `provider/model` from {@link resolveRepairModel}
 */
export function createRepairProposerAgent(args: {
  instructions: string;
  model: string;
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
  constructor(private readonly agent: StructuredRepairAgent) {}

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
 * @param args.model - Override {@link resolveRepairModel}
 */
export async function createConfiguredRepairProposer(args: {
  promptPolicy?: string;
  model?: string;
} = {}): Promise<{
  proposer: MastraRepairProposer;
  model: string;
}> {
  const policyText = args.promptPolicy ?? (await loadPromptPolicy());
  const model = args.model ?? resolveRepairModel();
  const instructions = `${policyText}\n\n${REPAIR_PROPOSER_INSTRUCTIONS}`;
  const agent = createRepairProposerAgent({ instructions, model });
  return {
    proposer: new MastraRepairProposer(agent),
    model,
  };
}
