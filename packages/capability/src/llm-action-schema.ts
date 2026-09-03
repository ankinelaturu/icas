/**
 * @file Flattened action JSON for OpenAI structured output.
 *
 * OpenAI's Responses API rejects JSON Schema `oneOf`. Catalog artifacts still
 * use {@link CapabilityActionSchema} discriminated unions. LLM `generate` uses
 * this flat shape; {@link llmActionToCapabilityAction} parses into the catalog type
 * and adds a `relative` fallback on fill/select/read when the model used a
 * caption as `label` or `visibleText`.
 */

import * as z from "zod";

import type { CapabilityAction, TargetDescriptor } from "./artifact.js";
import { CapabilityActionSchema } from "./artifact-schema.js";

/** Locator strategy types the model may emit (same vocabulary as the catalog). */
const LLM_STRATEGY_TYPES = [
  "roleText",
  "label",
  "visibleText",
  "css",
  "xpath",
  "relative",
  "coordinates",
] as const;

/**
 * One locator without a per-type discriminated union.
 *
 * Unused fields are `null` so the JSON Schema has no `oneOf`.
 */
export const LlmTargetStrategySchema = z.strictObject({
  type: z.enum(LLM_STRATEGY_TYPES),
  role: z.string().nullable(),
  text: z.string().nullable(),
  label: z.string().nullable(),
  selector: z.string().nullable(),
  xpath: z.string().nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  confidence: z.number().nullable(),
});

/**
 * Target with ranked strategies. Nullable on navigate/handoff.
 */
export const LlmTargetDescriptorSchema = z.strictObject({
  strategies: z.array(LlmTargetStrategySchema).min(1),
});

/**
 * Invocation param the model proposes for a fill/select.
 *
 * Lives on the candidate / trace, never on catalog {@link CapabilityAction}.
 * `name` is camelCase so replay CLI flags stay `--accountId`, not `--Account-Id`.
 */
export const ProposedInputParamSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, {
    error: "proposedInputParam.name must be camelCase",
  }),
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  required: z.boolean(),
});

export type ProposedInputParam = z.infer<typeof ProposedInputParamSchema>;

/**
 * Semantic action with every field present (null when unused).
 *
 * `value` is a fill/select literal string. Discovery parameterizes later;
 * this avoids a ValueRef `oneOf` in the model schema. `proposedInputParam` is
 * null on click/navigate/read/handoff; fill/select must supply the object.
 */
export const LlmCapabilityActionSchema = z.strictObject({
  type: z.enum(["click", "fill", "select", "navigate", "read", "handoff"]),
  intent: z.string().nullable(),
  risk: z.enum(["safe", "risky"]).nullable(),
  path: z.string().nullable(),
  reason: z.string().nullable(),
  value: z.string().nullable(),
  target: LlmTargetDescriptorSchema.nullable(),
  proposedInputParam: ProposedInputParamSchema.nullable(),
});

export type LlmCapabilityAction = z.infer<typeof LlmCapabilityActionSchema>;
export type LlmTargetStrategy = z.infer<typeof LlmTargetStrategySchema>;

/**
 * Map a flat LLM action onto {@link CapabilityActionSchema}.
 *
 * @param raw - Model output already parsed as {@link LlmCapabilityActionSchema}
 * @returns Catalog action
 * @throws {Error} When required fields for `type` are missing or invalid
 */
export function llmActionToCapabilityAction(raw: LlmCapabilityAction): CapabilityAction {
  const intent = raw.intent ?? undefined;
  const risk = raw.risk ?? undefined;
  const target =
    raw.target === null ? undefined : llmTargetToDescriptor(raw.target, raw.type);
  let candidate: unknown;
  switch (raw.type) {
    case "click":
    case "read":
      candidate = {
        type: raw.type,
        target,
        ...(intent === undefined ? {} : { intent }),
        ...(raw.type === "click" && risk !== undefined ? { risk } : {}),
      };
      break;
    case "fill":
    case "select":
      candidate = {
        type: raw.type,
        target,
        value: { literal: raw.value },
        ...(intent === undefined ? {} : { intent }),
        ...(risk === undefined ? {} : { risk }),
      };
      break;
    case "navigate":
      candidate = {
        type: "navigate",
        path: raw.path,
        ...(intent === undefined ? {} : { intent }),
        ...(risk === undefined ? {} : { risk }),
      };
      break;
    case "handoff":
      candidate = { type: "handoff", reason: raw.reason };
      break;
  }
  const parsed = CapabilityActionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`LLM action could not be mapped to a catalog action: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Build a catalog target from flat strategies.
 *
 * Fill/select/read also get a `relative` fallback. Core banking screens put
 * the caption in a table cell, so Playwright `getByLabel` / `getByText` miss
 * the adjacent input.
 *
 * @param raw - Non-null LLM target
 * @param actionType - Semantic action; relative fallback is fill/select/read only
 * @returns Catalog target with optional relative caption fallback
 */
export function llmTargetToDescriptor(
  raw: z.infer<typeof LlmTargetDescriptorSchema>,
  actionType: LlmCapabilityAction["type"],
): TargetDescriptor {
  return {
    strategies: uniqueStrategies(
      raw.strategies.flatMap((strategy) => expandLlmStrategy(strategy, actionType)),
    ),
  };
}

/**
 * Map one LLM strategy and, for field actions, add a relative caption fallback.
 *
 * @param raw - Flat strategy from the model
 * @param actionType - Surrounding action type
 */
function expandLlmStrategy(
  raw: LlmTargetStrategy,
  actionType: LlmCapabilityAction["type"],
): TargetDescriptor["strategies"] {
  const primary = llmStrategyToCatalog(raw);
  const caption = nonempty(raw.label) ?? nonempty(raw.text);
  const fieldAction =
    actionType === "fill" || actionType === "select" || actionType === "read";
  // Clicking a relative fallback would land on the following input, not the
  // control the model named. Only expand locators that target a field.
  if (!fieldAction || caption === undefined || raw.type === "relative") {
    return [primary];
  }
  if (raw.type !== "label" && raw.type !== "visibleText") {
    return [primary];
  }
  const relative: TargetDescriptor["strategies"][number] = {
    type: "relative",
    text: caption,
    ...(raw.confidence === null || raw.confidence === undefined
      ? {}
      : { confidence: raw.confidence }),
  };
  // Prefer relative first when the model left `label` empty and stuffed the
  // caption into `text` — that is a table-cell caption, not an associated
  // <label>, and getByLabel would burn a full locator timeout.
  if (raw.type === "label" && nonempty(raw.label) === undefined) {
    return [relative, primary];
  }
  return [primary, relative];
}

/**
 * Drop duplicate strategies after expansion.
 *
 * @param strategies - Ranked locators, possibly with repeats
 */
function uniqueStrategies(
  strategies: TargetDescriptor["strategies"],
): TargetDescriptor["strategies"] {
  const seen = new Set<string>();
  const unique: TargetDescriptor["strategies"] = [];
  for (const strategy of strategies) {
    const key = JSON.stringify(strategy);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(strategy);
  }
  return unique;
}

/**
 * Treat null/empty LLM strings as absent.
 *
 * @param value - Nullable schema field
 */
function nonempty(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * Keep only the fields that belong to `type`. Extra nulls are dropped.
 */
function llmStrategyToCatalog(
  raw: LlmTargetStrategy,
): TargetDescriptor["strategies"][number] {
  const confidence = raw.confidence ?? undefined;
  switch (raw.type) {
    case "roleText":
      return {
        type: "roleText",
        role: raw.role ?? "",
        text: raw.text ?? "",
        ...(confidence === undefined ? {} : { confidence }),
      };
    case "label":
      return {
        type: "label",
        label: raw.label ?? raw.text ?? "",
        ...(confidence === undefined ? {} : { confidence }),
      };
    case "visibleText":
      return {
        type: "visibleText",
        text: raw.text ?? "",
        ...(confidence === undefined ? {} : { confidence }),
      };
    case "css":
    case "xpath":
      return {
        type: raw.type,
        selector: raw.selector ?? "",
        ...(confidence === undefined ? {} : { confidence }),
      };
    case "relative":
      return {
        type: "relative",
        text: raw.text ?? "",
        ...(raw.role === null || raw.role === undefined ? {} : { role: raw.role }),
        ...(raw.xpath === null || raw.xpath === undefined ? {} : { xpath: raw.xpath }),
        ...(confidence === undefined ? {} : { confidence }),
      };
    case "coordinates":
      return {
        type: "coordinates",
        x: raw.x ?? 0,
        y: raw.y ?? 0,
        ...(confidence === undefined ? {} : { confidence }),
      };
  }
}
