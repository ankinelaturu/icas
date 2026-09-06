/**
 * @file Mastra-backed RepairProposer for `icas-play run --assist`.
 *
 * Lives in the app so `@icas/replay` stays model-free. ReplayEngine still
 * policy-checks, budgets, and requires path rejoin. This adapter only returns
 * {@link RepairProposal} — it never clicks. With a `log` sink it prints the
 * exact generate prompt and structured response (never the API key).
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
Do not execute actions. The runtime will policy-check them and require the original postconditions.

Prefer chrome the operator can see on the page (button/link text, including input type=submit values). Staff UIs often rename a submit (Inquire → Look Up) while the previous fill still works. Click that synonym. Do not retry the missing label with extra locator strategies.`;

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
  ): Promise<{ object?: unknown; text?: string; usage?: unknown }>;
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
 * Uses resolved `ICAS_ASSIST_LLM_*`.
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
 * Pretty-print the model reply without the Mastra envelope.
 *
 * Live `generate` returns `text` as escaped JSON plus nested `usage` /
 * `steps` / `messages`. Operators need the structured object, not that dump.
 *
 * @param result - Mastra `generate` return value
 */
export function formatLlmGenerateLog(result: unknown): string {
  const object = extractLlmObject(result);
  const lines = ["LLM response:"];
  if (object !== undefined) {
    lines.push(safeJson(object));
  } else {
    const text = extractLlmText(result);
    lines.push(text === undefined ? safeJson(result) : prettyJsonish(text));
  }
  const usage = extractLlmUsage(result);
  if (usage !== undefined) {
    lines.push(
      `LLM usage: input=${fmtCount(usage.inputTokens)} output=${fmtCount(usage.outputTokens)} total=${fmtCount(usage.totalTokens)}`,
    );
  }
  return lines.join("\n");
}

/**
 * Structured payload used for schema parse.
 *
 * Prefers `result.object`. If that is missing, parse JSON from `result.text`.
 *
 * @param result - Mastra `generate` return value
 */
export function extractLlmObject(result: unknown): unknown {
  if (result !== null && typeof result === "object") {
    const record = result as { object?: unknown; text?: unknown };
    if (record.object !== undefined) {
      return record.object;
    }
    if (typeof record.text === "string") {
      const parsed = tryParseJson(record.text);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Model text field when present.
 *
 * @param result - Mastra `generate` return value
 */
function extractLlmText(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") {
    return undefined;
  }
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

/**
 * Token counts only. Nested `usage.raw` is omitted.
 *
 * @param result - Mastra `generate` return value
 */
function extractLlmUsage(result: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined {
  if (result === null || typeof result !== "object") {
    return undefined;
  }
  const usage = (result as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") {
    return undefined;
  }
  const record = usage as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
  };
  const inputTokens = asFiniteNumber(record.inputTokens);
  const outputTokens = asFiniteNumber(record.outputTokens);
  const totalTokens = asFiniteNumber(record.totalTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

/**
 * Pretty-print a JSON string; leave other text alone.
 *
 * @param value - `result.text` or already-parsed JSON
 */
function prettyJsonish(value: string): string {
  const parsed = tryParseJson(value);
  return parsed === undefined ? value : safeJson(parsed);
}

/**
 * Parse JSON text. Empty or invalid input is unset.
 *
 * @param raw - Candidate JSON
 */
function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Finite number from a JSON field.
 *
 * @param value - Token count
 */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Token count for the usage line. Missing is `?`.
 *
 * @param value - Parsed count
 */
function fmtCount(value: number | undefined): string {
  return value === undefined ? "?" : String(value);
}

/**
 * One `generate` per failed step. Validates {@link RepairProposal} before return.
 */
export class MastraRepairProposer implements RepairProposer {
  private readonly modelSettings: ReturnType<typeof toMastraModelSettings>;
  private readonly log: ((line: string) => void) | undefined;
  private readonly instructions: string | undefined;
  private readonly settings: IcasLlmSettings | undefined;
  private loggedInstructions = false;

  /**
   * @param agent - Mastra `generate` (or a test fake)
   * @param options.log - Stdout sink for the exact prompt and structured response
   * @param options.instructions - System text passed to the Agent
   * @param options.settings - Transport + sampling; API key is never logged
   */
  constructor(
    private readonly agent: StructuredRepairAgent,
    options: {
      settings?: IcasLlmSettings;
      log?: (line: string) => void;
      instructions?: string;
    } = {},
  ) {
    this.modelSettings =
      options.settings === undefined ? {} : toMastraModelSettings(options.settings);
    this.log = options.log;
    this.instructions = options.instructions;
    this.settings = options.settings;
  }

  /**
   * Ask Mastra once for replacement actions for `context.step` only.
   *
   * Logs the system instructions, the exact user message passed to
   * `generate`, the structured model object (not the Mastra envelope),
   * then the catalog mapping. Do not omit the prompt: operators cannot
   * debug a bad repair without it.
   *
   * @param context - Frozen failure from ReplayEngine
   * @returns Typed repair
   * @throws {Error} When `result.object` is not a RepairProposal
   */
  async propose(context: RepairContext): Promise<RepairProposal> {
    const userPrompt = formatRepairPrompt(context);
    this.logOutgoing(context, userPrompt);
    let result: { object?: unknown; text?: string; usage?: unknown };
    try {
      result = await this.agent.generate(userPrompt, {
        structuredOutput: { schema: LlmRepairProposalSchema },
        ...(Object.keys(this.modelSettings).length === 0
          ? {}
          : { modelSettings: this.modelSettings }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log?.(`LLM generate failed: ${message}`);
      throw error;
    }
    this.log?.(formatLlmGenerateLog(result));
    const object = extractLlmObject(result);
    const parsed = LlmRepairProposalSchema.safeParse(object);
    if (!parsed.success) {
      this.log?.(`LLM response failed schema: ${parsed.error.message}`);
      throw new Error(`repair proposer returned an invalid RepairProposal: ${parsed.error.message}`);
    }
    this.log?.(`LLM rationale: ${parsed.data.rationale}`);
    const mapped: RepairProposal = {
      actions: parsed.data.actions.map(llmActionToCapabilityAction),
      rationale: parsed.data.rationale,
    };
    this.log?.(`LLM mapped RepairProposal:\n${safeJson(mapped)}`);
    return mapped;
  }

  /**
   * Print transport, system instructions (once), and the user message.
   *
   * @param context - Frozen step plus failure
   * @param userPrompt - Exact string passed to `generate`
   */
  private logOutgoing(context: RepairContext, userPrompt: string): void {
    if (this.log === undefined) {
      return;
    }
    this.log(
      `LLM generate step=${context.step.id} code=${context.failure.code} pageTextChars=${String(context.pageText.length)}`,
    );
    if (this.settings !== undefined) {
      this.log(`LLM transport: ${safeJson(publicLlmTransport(this.settings))}`);
    }
    if (Object.keys(this.modelSettings).length > 0) {
      this.log(`LLM modelSettings: ${safeJson(this.modelSettings)}`);
    }
    if (
      !this.loggedInstructions &&
      this.instructions !== undefined &&
      this.instructions.length > 0
    ) {
      this.loggedInstructions = true;
      this.log(`LLM agent instructions (system):\n${this.instructions}`);
    }
    this.log(`LLM user prompt (exact generate message):\n${userPrompt}`);
  }
}

/** Cap visible body text in the repair user message. Same bound as adapt. */
export const ASSIST_PAGE_TEXT_MAX = 12_000;

/**
 * User message for one assist attempt.
 *
 * Page text is clipped so a large table does not dominate the prompt.
 * `observation.imagePath` is a filesystem path in this string, not pixels.
 * Whether `--assist` also attaches screenshot bytes is Pass 5.22.
 *
 * @param context - Frozen step, capability, failure, observation, and page text
 */
export function formatRepairPrompt(context: RepairContext): string {
  const clipped = clipPageText(context.pageText);
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

Visible page text:
${clipped.length === 0 ? "(none)" : clipped}

Respond with a RepairProposal object.`;
}

/**
 * Clip body text for the repair prompt.
 *
 * @param pageText - Raw `visibleText()`
 */
export function clipPageText(pageText: string): string {
  if (pageText.length <= ASSIST_PAGE_TEXT_MAX) {
    return pageText;
  }
  return `${pageText.slice(0, ASSIST_PAGE_TEXT_MAX)}\n…[truncated]`;
}

/**
 * Production repair proposer: packaged prompt policy + Mastra model router.
 *
 * Does not call the network until {@link MastraRepairProposer.propose}.
 *
 * @param args.promptPolicy - Inline markdown; skips {@link loadPromptPolicy} when set
 * @param args.model - Override model id (tests)
 * @param args.env - Process env for `ICAS_ASSIST_LLM_*`
 * @param args.log - Stdout sink for the exact prompt and structured response
 */
export async function createConfiguredRepairProposer(args: {
  promptPolicy?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
} = {}): Promise<{
  proposer: MastraRepairProposer;
  model: string;
  instructions: string;
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
  args.log?.(
    `LLM repair proposer constructed model=${modelId} transport=${safeJson(publicLlmTransport(effective))}`,
  );
  return {
    proposer: new MastraRepairProposer(agent, {
      settings: effective,
      instructions,
      ...(args.log === undefined ? {} : { log: args.log }),
    }),
    model: modelId,
    instructions,
  };
}

/**
 * JSON for logs. Never throws on a weird value.
 *
 * @param value - Prompt payload or generate result
 */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Transport fields safe for stdout. Never include `apiKey`.
 *
 * @param settings - Resolved `ICAS_ASSIST_LLM_*`
 */
function publicLlmTransport(settings: IcasLlmSettings): {
  model: string;
  hasApiKey: boolean;
  baseUrl?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
} {
  return {
    model: settings.model,
    hasApiKey: settings.apiKey !== undefined && settings.apiKey.length > 0,
    ...(settings.baseUrl === undefined ? {} : { baseUrl: settings.baseUrl }),
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.topK === undefined ? {} : { topK: settings.topK }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    ...(settings.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: settings.maxOutputTokens }),
  };
}
