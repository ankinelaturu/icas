/**
 * @file Derive semantic locators, checkpoints, and outputs from a success path.
 *
 * Replay prefers labels and visible text over screenshot coordinates.
 * Checkpoints come from the model's expectation and observed URLs, not from
 * re-running the LLM.
 */

import type {
  Assertion,
  CapabilityAction,
  CapabilityStep,
  TargetDescriptor,
} from "@icas/capability";

import type { SuccessfulPathStep } from "./extract-successful-path.js";

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
