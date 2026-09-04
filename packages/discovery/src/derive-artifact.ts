/**
 * @file Derive semantic locators, checkpoints, and outputs from a success path.
 *
 * Replay prefers labels and visible text over screenshot coordinates.
 * Checkpoints come from the model's expectation and observed URLs.
 * `artifactOutputsFromResult` maps the proposer’s success `result.outputs`.
 * `durableSuccessSignals` reduces textVisible chrome that embeds dates, ids,
 * or fill literals to a stable heading.
 */

import type {
  Assertion,
  CapabilityAction,
  CapabilityStep,
  TargetDescriptor,
} from "@icas/capability";

import type { SuccessfulPathStep } from "./extract-successful-path.js";
import type { DiscoverySuccessOutput } from "./candidate-action.js";

/**
 * Drop coordinate locators when a semantic strategy exists.
 *
 * Coordinate-only targets stay intact so the step remains executable.
 *
 * @param action - Success-path action after parameterization
 */
export function semanticAction(action: CapabilityAction): CapabilityAction {
  if (!("target" in action)) {
    return action;
  }
  return { ...action, target: semanticTarget(action.target) };
}

/**
 * Keep non-coordinate strategies. If filtering would empty `strategies`,
 * return the original descriptor so a last-resort click still has a target.
 */
export function semanticTarget(target: TargetDescriptor): TargetDescriptor {
  const strategies = target.strategies.filter((strategy) => strategy.type !== "coordinates");
  if (strategies.length === 0) {
    return target;
  }
  return { strategies };
}

/**
 * Preconditions from prior state; postconditions from the model's expectation
 * and the observation after the action.
 *
 * Prefer the previous step's expectation as `textVisible` because the model
 * named what should be on screen. Fall back to the prior URL pathname.
 */
export function deriveCheckpoints(
  step: SuccessfulPathStep,
  previous: SuccessfulPathStep | undefined,
): { preconditions: Assertion[]; postconditions: Assertion[] } {
  const preconditions: Assertion[] = [];
  const priorText = previous?.expectation;
  if (priorText !== undefined) {
    preconditions.push({ type: "textVisible", value: priorText });
  } else {
    const priorUrl = urlPattern(step.before?.url);
    if (priorUrl !== undefined) {
      preconditions.push({ type: "urlMatches", pattern: priorUrl });
    }
  }
  const postconditions: Assertion[] = [];
  if (step.expectation !== undefined) {
    postconditions.push({ type: "textVisible", value: step.expectation });
  }
  const afterUrl = urlPattern(step.after?.url);
  if (afterUrl !== undefined) {
    postconditions.push({ type: "urlMatches", pattern: afterUrl });
  }
  return { preconditions, postconditions };
}

/**
 * Final success assertions from the last kept step.
 *
 * Always returns at least one assertion so the artifact is valid. Prefer the
 * last expectation; else the last URL pathname; else a generic visible string.
 */
export function deriveSuccess(path: readonly SuccessfulPathStep[]): Assertion[] {
  const last = path[path.length - 1];
  if (last?.expectation !== undefined) {
    return [{ type: "textVisible", value: last.expectation }];
  }
  const pattern = urlPattern(last?.after?.url);
  if (pattern !== undefined) {
    return [{ type: "urlMatches", pattern }];
  }
  return [{ type: "textVisible", value: "completed" }];
}

/**
 * Keep success assertions that still hold when replay uses different inputs.
 *
 * `textVisible` copied from a confirmation screen often includes this run's
 * id, amount, or processing date. Replay then fails on the next invocation.
 * Reduce those sentences to a stable heading (text before `·` / `:` / `|`)
 * when that heading has no ephemeral data. `urlMatches` is unchanged.
 *
 * @param declared - Proposer `successSignals`, or {@link deriveSuccess} output
 * @param path - Success-path steps (fill literals still present)
 * @returns At least one assertion (URL fallback if nothing durable remains)
 */
export function durableSuccessSignals(
  declared: readonly Assertion[],
  path: readonly SuccessfulPathStep[],
): Assertion[] {
  const tokens = invocationLiterals(path);
  const kept = uniqueAssertions(declared.flatMap((signal) => durableAssertion(signal, tokens)));
  if (kept.length > 0) {
    return kept;
  }
  const fallback = uniqueAssertions(
    deriveSuccess(path).flatMap((signal) => durableAssertion(signal, tokens)),
  );
  if (fallback.length > 0) {
    return fallback;
  }
  const pattern = urlPattern(path[path.length - 1]?.after?.url);
  if (pattern !== undefined) {
    return [{ type: "urlMatches", pattern }];
  }
  return [{ type: "textVisible", value: "completed" }];
}

/**
 * Fill/select literals from this discovery run, plus money-without-dot forms.
 *
 * Confirmation ids often concatenate cents (`250.00` → `25000`).
 *
 * @param path - Success-path steps
 */
function invocationLiterals(path: readonly SuccessfulPathStep[]): string[] {
  const tokens = new Set<string>();
  for (const step of path) {
    const action = step.action;
    if (action.type !== "fill" && action.type !== "select") {
      continue;
    }
    const ref = action.value;
    if (typeof ref !== "object" || ref === null || !("literal" in ref)) {
      continue;
    }
    const literal = ref.literal;
    if (typeof literal !== "string") {
      continue;
    }
    const trimmed = literal.trim();
    // Skip 1–2 character tokens so "01" does not wipe every signal.
    if (trimmed.length < 3) {
      continue;
    }
    tokens.add(trimmed);
    if (/^\d+\.\d{1,2}$/.test(trimmed)) {
      tokens.add(trimmed.replace(".", ""));
    }
  }
  return [...tokens];
}

/**
 * Map one success assertion onto zero or one durable assertion.
 *
 * @param signal - Candidate success assertion
 * @param tokens - {@link invocationLiterals}
 */
function durableAssertion(
  signal: Assertion,
  tokens: readonly string[],
): Assertion[] {
  if (signal.type !== "textVisible" || typeof signal.value !== "string") {
    return [signal];
  }
  const text = durableVisibleText(signal.value, tokens);
  if (text === undefined) {
    return [];
  }
  return [{ type: "textVisible", value: text }];
}

/**
 * ISO dates, US dates, money, and hyphenated confirmation ids that change
 * per invocation. Not product names.
 */
const EPHEMERAL_IN_TEXT = [
  /\d{4}-\d{2}-\d{2}/,
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
  /\b\d+\.\d{2}\b/,
  /\b[A-Z]{2,}(?:-\d+){2,}\b/,
];

/**
 * True when the string still carries this-run data.
 *
 * @param value - Visible chrome
 * @param tokens - Fill/select literals from this path
 */
function hasEphemeralData(value: string, tokens: readonly string[]): boolean {
  if (EPHEMERAL_IN_TEXT.some((pattern) => pattern.test(value))) {
    return true;
  }
  return tokens.some((token) => value.includes(token));
}

/**
 * Stable heading, or undefined when the whole string is instance data.
 *
 * When the copied sentence mixed a heading with a date/id/amount, keep the
 * clause before `·`, `:`, or `|` if that clause is itself durable.
 *
 * @param value - Proposer `textVisible` value
 * @param tokens - Fill/select literals from this path
 */
function durableVisibleText(
  value: string,
  tokens: readonly string[],
): string | undefined {
  if (!hasEphemeralData(value, tokens)) {
    return value;
  }
  const heading = value.split(/\s*[·|:]\s*/u)[0]?.trim() ?? "";
  if (heading.length >= 8 && !hasEphemeralData(heading, tokens)) {
    return heading;
  }
  return undefined;
}

/**
 * Drop duplicate assertions after reducing two sentences to the same heading.
 *
 * @param assertions - Possibly repeating locators
 */
function uniqueAssertions(assertions: readonly Assertion[]): Assertion[] {
  const seen = new Set<string>();
  const unique: Assertion[] = [];
  for (const assertion of assertions) {
    const key = JSON.stringify(assertion);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(assertion);
  }
  return unique;
}

/**
 * `read` actions become named outputs with extract targets.
 *
 * Names that look like amounts or balances are typed `money` for banking UIs.
 * Other reads stay `string`.
 */
export function deriveOutputs(
  steps: readonly CapabilityStep[],
): CapabilityArtifactOutputs {
  const outputs: CapabilityArtifactOutputs = {};
  for (const step of steps) {
    if (step.action.type !== "read") {
      continue;
    }
    const name = outputName(step);
    outputs[name] = {
      type: name.toLowerCase().includes("amount") || name.toLowerCase().includes("balance")
        ? "money"
        : "string",
      extract: { target: step.action.target },
    };
  }
  return outputs;
}

/**
 * Map proposer success outputs onto the artifact `outputs` record.
 *
 * Duplicate names fail closed so replay does not silently drop a field.
 *
 * @param declared - `result.outputs` from the success event
 * @returns Catalog outputs map
 * @throws {Error} When two declarations share a name
 */
export function artifactOutputsFromResult(
  declared: readonly DiscoverySuccessOutput[],
): CapabilityArtifactOutputs {
  const outputs: CapabilityArtifactOutputs = {};
  for (const item of declared) {
    if (outputs[item.name] !== undefined) {
      throw new Error(`CapabilityCompiler: duplicate output name "${item.name}"`);
    }
    outputs[item.name] = {
      type: item.type,
      ...(item.description === undefined ? {} : { description: item.description }),
      extract: item.extract,
    };
  }
  return outputs;
}

/**
 * Stable step id from action type plus locator text. Suffix on collision
 * so two clicks with the same label do not share an id.
 *
 * @param action - Already parameterized / semantic action
 * @param index - Success-path index, used when the locator has no text
 * @param used - Ids already assigned on this compile
 */
export function uniqueStepId(action: CapabilityAction, index: number, used: Set<string>): string {
  const label = actionLabel(action);
  const base = label.length > 0 ? `${action.type}-${slug(label)}` : `${action.type}-${String(index + 1)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

type CapabilityArtifactOutputs = Record<
  string,
  { type: "string" | "number" | "boolean" | "date" | "money"; extract?: { target: TargetDescriptor } }
>;

/** Prefer `read` intent (model-named); else camelCase the locator text. */
function outputName(step: CapabilityStep): string {
  if (step.action.type === "read" && step.action.intent !== undefined) {
    return step.action.intent;
  }
  const label = actionLabel(step.action);
  return camelCase(label.length > 0 ? label : step.id);
}

function actionLabel(action: CapabilityAction): string {
  if (action.type === "navigate") {
    return action.path;
  }
  if (action.type === "handoff") {
    return action.reason;
  }
  const first = action.target.strategies[0];
  if (first === undefined) {
    return "";
  }
  // Prefer visible text, then accessible label — the same cues replay uses.
  if ("text" in first && typeof first.text === "string") {
    return first.text;
  }
  if ("label" in first && typeof first.label === "string") {
    return first.label;
  }
  return "";
}

/**
 * Pathname-only pattern so replay is not pinned to a discovery host.
 *
 * `http`/`https` use `pathname`. Other schemes take the last path segment.
 * Invalid URLs that already look like a path are kept.
 */
export function urlPattern(url: string | undefined): string | undefined {
  if (url === undefined || url.length === 0) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.pathname.length > 0 ? parsed.pathname : undefined;
    }
    const last = parsed.pathname.split("/").filter((part) => part.length > 0).pop();
    return last;
  } catch {
    return url.startsWith("/") ? url : undefined;
  }
}

function slug(value: string): string {
  // Cap length so step ids stay readable in the catalog JSON.
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function camelCase(value: string): string {
  const parts = slug(value).split("-").filter((part) => part.length > 0);
  // Empty slug (punctuation-only label) still needs a valid output name.
  if (parts.length === 0) {
    return "extractedValue";
  }
  return parts
    .map((part, index) => (index === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join("");
}
