/**
 * @file Rewrite fill/select literals using proposer `proposedInputParam` hints.
 *
 * Replay must not bake discovery-time literals into the artifact. The compiler
 * aggregates unique names from the success path; it does not reverse-map CLI
 * flags onto fill values.
 */

import type {
  CapabilityAction,
  PrimitiveType,
  ProposedInputParam,
} from "@icas/capability";

/**
 * One success-path step as seen by the parameterizer.
 *
 * `proposedInputParam` is required for fill/select. Catalog `CapabilityAction`
 * never carries the hint.
 */
export interface ParameterizeStep {
  action: CapabilityAction;
  proposedInputParam?: ProposedInputParam;
}

/**
 * Thrown when fill/select cannot be parameterized from proposer hints.
 */
export class ParameterizeError extends Error {
  /**
   * @param message - Missing hint, type clash, or literal bound to two names
   */
  constructor(message: string) {
    super(message);
    this.name = "ParameterizeError";
  }
}

/**
 * Rewrite a fill/select literal to `{ input: name }` using the proposer hint.
 *
 * Click/navigate/read/handoff pass through. Already-parameterized `{ input }`
 * refs are left alone after the hint is checked.
 *
 * @param action - One success-path action before semantic locator cleanup
 * @param hint - Proposer name/type/required for this fill/select
 * @returns A new action when a fill/select was rewritten; otherwise `action`
 * @throws {ParameterizeError} When fill/select has no hint
 */
export function parameterizeAction(
  action: CapabilityAction,
  hint: ProposedInputParam | undefined,
): CapabilityAction {
  if (action.type !== "fill" && action.type !== "select") {
    return action;
  }
  if (hint === undefined) {
    throw new ParameterizeError(
      "fill/select on the success path requires proposedInputParam",
    );
  }
  return { ...action, value: { input: hint.name } };
}

/**
 * Aggregate unique `proposedInputParam` entries from the success path.
 *
 * Same name must keep the same type and `required`. The same discovery
 * literal must not bind to two names.
 *
 * @param steps - Success-path actions still carrying discovery literals
 * @returns Artifact `inputs` map
 * @throws {ParameterizeError} On missing hint, clash, or dual binding
 */
export function inputsFromHints(
  steps: readonly ParameterizeStep[],
): Record<string, { type: PrimitiveType; required: boolean }> {
  // byName becomes artifact.inputs. literalToName detects one discovery value
  // bound to two param names (a compile clash, not a replay concern).
  const byName = new Map<string, { type: PrimitiveType; required: boolean }>();
  const literalToName = new Map<string, string>();

  for (const step of steps) {
    if (step.action.type !== "fill" && step.action.type !== "select") {
      continue;
    }
    const hint = step.proposedInputParam;
    if (hint === undefined) {
      throw new ParameterizeError(
        "fill/select on the success path requires proposedInputParam",
      );
    }
    const existing = byName.get(hint.name);
    if (existing !== undefined) {
      if (existing.type !== hint.type || existing.required !== hint.required) {
        throw new ParameterizeError(
          `proposedInputParam "${hint.name}" type/required clash`,
        );
      }
    } else {
      byName.set(hint.name, { type: hint.type, required: hint.required });
    }
    const literal = step.action.value.literal;
    if (literal === undefined) {
      continue;
    }
    const key = String(literal);
    const bound = literalToName.get(key);
    if (bound !== undefined && bound !== hint.name) {
      throw new ParameterizeError(
        `discovery literal bound to both "${bound}" and "${hint.name}"`,
      );
    }
    literalToName.set(key, hint.name);
  }

  return Object.fromEntries(byName);
}
