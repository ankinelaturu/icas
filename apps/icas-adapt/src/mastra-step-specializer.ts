/**
 * @file Mastra-backed StepSpecializer for icas-adapt.
 *
 * Lives in the app so `@icas/replay` stays model-free. Guarded replay already
 * failed one step with no LLM; this adapter proposes a one-step
 * {@link StepOverride} from visible page text. Catalog write and re-verify
 * happen in `runGuardedAdapt`, not here.
 */

import { Agent } from "@mastra/core/agent";
import {
  llmTargetToDescriptor,
  LlmTargetDescriptorSchema,
  StepOverrideSchema,
  type CapabilityAction,
  type CapabilityStep,
  type LlmCapabilityAction,
  type StepOverride,
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
import type { GuardedReplayReport } from "@icas/replay";
import { z } from "zod";

import type { StepSpecializer } from "./build-override.js";

/** Default model id. Override with `ICAS_ADAPT_LLM_MODEL`. */
export const DEFAULT_ADAPT_MODEL = DEFAULT_ICAS_LLM_MODEL;

/** Stable Mastra agent id. Adapt is not discovery DFS and not `--assist`. */
export const STEP_SPECIALIZER_AGENT_ID = "icas-step-specializer";

/**
 * Cap visible body text in the user message.
 *
 * Staff screens can dump a large table; the model only needs nearby chrome
 * (button labels, headings) to propose a locator synonym.
 */
export const ADAPT_PAGE_TEXT_MAX = 12_000;

/**
 * Flat override for Mastra `generate`. OpenAI rejects catalog `oneOf`.
 *
 * Target-only patches cover Inquire → Look Up. Optional postcondition text
 * replaces the failed step's `textVisible` checkpoint when the chrome phrase
 * also changed.
 */
export const LlmStepOverrideSchema = z.strictObject({
  target: LlmTargetDescriptorSchema,
  postconditionText: z.string().nullable(),
  rationale: z.string().min(1),
});

/** Contract text for Mastra `instructions`. */
export const STEP_SPECIALIZER_INSTRUCTIONS = `You specialize ONE failed replay step on a bank or credit union staff back-office UI. This is not consumer or retail online banking.

The base capability already works at another tenant. Guarded replay stopped at this step because a locator or checkpoint phrase did not match. Propose a one-step StepOverride for that step only.

Return ONLY a JSON object:
- target: ranked locator strategies for the control that should have been used (roleText, visibleText, label, css). Prefer chrome the operator can see on the page (button/link text).
- postconditionText: the visible phrase that should appear after the action, or null if the original postconditions still apply
- rationale: why this chrome is the tenant synonym of the failed locator

This is not rediscovery. Do not invent a new workflow, extra steps, or JavaScript. Do not execute actions. The "expected" field is the missing control. Staff UIs often rename a submit (Inquire → Look Up) while the previous fill still works. Patch that click, not the fill. Page text includes input type=submit values. Prefer chrome the operator can see. If the page has no plausible synonym, still return the closest visible control rather than an empty target.`;

/**
 * Mastra `Agent.generate` surface used by the adapter. Tests mock this.
 */
export interface StructuredSpecializeAgent {
  generate(
    messages: string,
    options: {
      structuredOutput: { schema: typeof LlmStepOverrideSchema };
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
 * Resolve the adapt `provider/model` id.
 *
 * @param env - Process env; inject in tests
 */
export function resolveAdaptModel(env: NodeJS.ProcessEnv = process.env): string {
  return resolveIcasLlmSettings("adapt", env).model;
}

/**
 * True when `icas-adapt` can call a live model for a mismatch patch.
 *
 * Uses resolved `ICAS_ADAPT_LLM_*`. Compatible enrollments skip the model
 * even when this is true.
 *
 * @param env - Process env
 */
export function hasAdaptLlm(env: NodeJS.ProcessEnv = process.env): boolean {
  return isIcasLlmReady(resolveIcasLlmSettings("adapt", env));
}

/**
 * Build the Mastra Agent used as the step specializer.
 *
 * No tools are registered: the model ranks locators; ReplayEngine re-verifies.
 *
 * @param args.instructions - Prompt-policy markdown plus {@link STEP_SPECIALIZER_INSTRUCTIONS}
 * @param args.model - From {@link toMastraModelConfig}
 */
export function createStepSpecializerAgent(args: {
  instructions: string;
  model: string | { id: `${string}/${string}`; apiKey?: string; url?: string };
}): Agent {
  return new Agent({
    id: STEP_SPECIALIZER_AGENT_ID,
    name: "ICAS Step Specializer",
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
 * One `generate` per mismatched step. Validates {@link StepOverride} before return.
 */
export class MastraStepSpecializer implements StepSpecializer {
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
    private readonly agent: StructuredSpecializeAgent,
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
   * Ask Mastra once for a target patch on `args.step` only.
   *
   * Logs the system instructions, the exact user message passed to
   * `generate`, the structured model object (not the Mastra envelope),
   * then the catalog mapping. Do not omit the prompt: operators cannot
   * debug a bad patch without it.
   *
   * @param args.step - Divergent base step
   * @param args.report - Guarded mismatch (includes failure code)
   * @param args.pageText - Visible body text at the miss; may be empty in tests
   * @returns Catalog {@link StepOverride}
   * @throws {Error} When `result.object` is not a mappable StepOverride
   */
  async specialize(args: {
    step: CapabilityStep;
    report: Extract<GuardedReplayReport, { status: "mismatch" }>;
    pageText: string;
  }): Promise<StepOverride> {
    const userPrompt = formatSpecializePrompt(args);
    this.logOutgoing(args, userPrompt);
    let result: { object?: unknown; text?: string; usage?: unknown };
    try {
      result = await this.agent.generate(userPrompt, {
        structuredOutput: { schema: LlmStepOverrideSchema },
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
    const parsed = LlmStepOverrideSchema.safeParse(object);
    if (!parsed.success) {
      this.log?.(`LLM response failed schema: ${parsed.error.message}`);
      throw new Error(`step specializer returned an invalid StepOverride: ${parsed.error.message}`);
    }
    this.log?.(`LLM rationale: ${parsed.data.rationale}`);
    let mapped: StepOverride;
    try {
      mapped = llmStepOverrideToCatalog(parsed.data, args.step.action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log?.(`LLM response failed catalog mapping: ${message}`);
      throw error;
    }
    this.log?.(`LLM mapped StepOverride:\n${safeJson(mapped)}`);
    return mapped;
  }

  /**
   * Print transport, system instructions (once), and the user message.
   *
   * @param args - Failed step plus mismatch
   * @param userPrompt - Exact string passed to `generate`
   */
  private logOutgoing(
    args: {
      step: CapabilityStep;
      report: Extract<GuardedReplayReport, { status: "mismatch" }>;
      pageText: string;
    },
    userPrompt: string,
  ): void {
    if (this.log === undefined) {
      return;
    }
    this.log(
      `LLM generate step=${args.step.id} code=${args.report.result.code} pageTextChars=${String(args.pageText.length)}`,
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

/**
 * Map a flat LLM override onto {@link StepOverrideSchema}.
 *
 * Uses the failed step's action type so fill/select get the same `relative`
 * caption fallback as discovery. Navigate/handoff have no target in the
 * catalog; those mismatches still map as click locators.
 *
 * @param raw - Model output already parsed as {@link LlmStepOverrideSchema}
 * @param action - Failed catalog action (for strategy expansion)
 * @returns Catalog step override
 * @throws {Error} When mapped fields fail {@link StepOverrideSchema}
 */
export function llmStepOverrideToCatalog(
  raw: z.infer<typeof LlmStepOverrideSchema>,
  action: CapabilityAction,
): StepOverride {
  const target = llmTargetToDescriptor(raw.target, mappingActionType(action));
  const postconditionText = nonempty(raw.postconditionText);
  const candidate: StepOverride = {
    target,
    ...(postconditionText === undefined
      ? {}
      : { postconditions: [{ type: "textVisible" as const, value: postconditionText }] }),
  };
  const parsed = StepOverrideSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `step specializer could not map to a catalog StepOverride: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Action type passed to {@link llmTargetToDescriptor}.
 *
 * Fill/select/read get a relative caption fallback. Click stays click.
 * Navigate/handoff have no target; treat them as click so a chrome synonym
 * still produces strategies.
 *
 * @param action - Failed catalog action
 */
function mappingActionType(action: CapabilityAction): LlmCapabilityAction["type"] {
  switch (action.type) {
    case "click":
    case "fill":
    case "select":
    case "read":
      return action.type;
    case "navigate":
    case "handoff":
      return "click";
  }
}

/**
 * User message for one specialize attempt.
 *
 * Page text is clipped so a large table does not dominate the prompt.
 *
 * @param args.step - Failed step
 * @param args.report - Mismatch report
 * @param args.pageText - Visible body text
 */
export function formatSpecializePrompt(args: {
  step: CapabilityStep;
  report: Extract<GuardedReplayReport, { status: "mismatch" }>;
  pageText: string;
}): string {
  const clipped = clipPageText(args.pageText);
  return `Failed step: ${args.step.id}
Failure code: ${args.report.result.code}
Expected: ${JSON.stringify(args.report.expected)}
Observed: ${JSON.stringify(args.report.observed)}

Original step action: ${JSON.stringify(args.step.action)}
Original postconditions: ${JSON.stringify(args.step.postconditions)}

Visible page text:
${clipped.length === 0 ? "(none)" : clipped}

Respond with a one-step StepOverride object.`;
}

/**
 * Clip body text for the specialize prompt.
 *
 * @param pageText - Raw `innerText`
 */
export function clipPageText(pageText: string): string {
  if (pageText.length <= ADAPT_PAGE_TEXT_MAX) {
    return pageText;
  }
  return `${pageText.slice(0, ADAPT_PAGE_TEXT_MAX)}\n…[truncated]`;
}

/**
 * Production specializer: packaged prompt policy + Mastra model router.
 *
 * Does not call the network until {@link MastraStepSpecializer.specialize}.
 *
 * @param args.promptPolicy - Inline markdown; skips {@link loadPromptPolicy} when set
 * @param args.model - Override model id (tests)
 * @param args.env - Process env for `ICAS_ADAPT_LLM_*`
 */
export async function createConfiguredStepSpecializer(args: {
  promptPolicy?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
} = {}): Promise<{
  specializer: MastraStepSpecializer;
  model: string;
  instructions: string;
}> {
  const policyText = args.promptPolicy ?? (await loadPromptPolicy());
  const settings = resolveIcasLlmSettings("adapt", args.env ?? process.env);
  const modelId = args.model ?? settings.model;
  const effective: IcasLlmSettings = { ...settings, model: modelId };
  const instructions = `${policyText}\n\n${STEP_SPECIALIZER_INSTRUCTIONS}`;
  const agent = createStepSpecializerAgent({
    instructions,
    model: toMastraModelConfig(effective),
  });
  args.log?.(
    `LLM specializer constructed model=${modelId} transport=${safeJson(publicLlmTransport(effective))}`,
  );
  return {
    specializer: new MastraStepSpecializer(agent, {
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
 * @param settings - Resolved `ICAS_ADAPT_LLM_*`
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

/**
 * First non-empty string. Empty and null are unset.
 *
 * @param value - Model field
 */
function nonempty(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value.length === 0) {
    return undefined;
  }
  return value;
}
