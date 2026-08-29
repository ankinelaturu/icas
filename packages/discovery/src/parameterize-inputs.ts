/**
 * @file Replace concrete discovery values with ValueRef input references.
 */

import type { CapabilityAction, PrimitiveType } from "@icas/capability";

/**
 * A value observed during discovery that should become a typed capability input.
 */
export interface DiscoveredInput {
  type: PrimitiveType;
  value: unknown;
  description?: string;
}

/**
 * Rewrite fill/select literals that match a discovered input value.
 */
export function parameterizeAction(
  action: CapabilityAction,
  inputValues: Record<string, DiscoveredInput>,
): CapabilityAction {
  if (action.type !== "fill" && action.type !== "select") {
    return action;
  }
  if (action.value.input !== undefined) {
    return action;
  }
  const literal = action.value.literal;
  const name = inputNameForLiteral(literal, inputValues);
  if (name === undefined) {
    return action;
  }
  return { ...action, value: { input: name } };
}

/**
 * Input params that actually appear on parameterized steps.
 */
export function inputsFromActions(
  actions: readonly CapabilityAction[],
  inputValues: Record<string, DiscoveredInput>,
): Record<string, { type: PrimitiveType; required: true; description?: string }> {
  const used = new Set<string>();
  for (const action of actions) {
    if ((action.type === "fill" || action.type === "select") && action.value.input !== undefined) {
      used.add(action.value.input);
    }
  }
  const inputs: Record<
    string,
    { type: PrimitiveType; required: true; description?: string }
  > = {};
  for (const name of used) {
    const spec = inputValues[name];
    if (spec === undefined) {
      continue;
    }
    inputs[name] = {
      type: spec.type,
      required: true,
      ...(spec.description === undefined ? {} : { description: spec.description }),
    };
  }
  return inputs;
}

function inputNameForLiteral(
  literal: unknown,
  inputValues: Record<string, DiscoveredInput>,
): string | undefined {
  for (const [name, spec] of Object.entries(inputValues)) {
    if (String(literal) === String(spec.value)) {
      return name;
    }
  }
  return undefined;
}
