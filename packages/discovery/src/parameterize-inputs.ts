/**
 * @file Replace concrete discovery values with ValueRef input references.
 *
 * Replay must not bake a discovery-time literal (e.g. loan id `987654`) into
 * the artifact. Only fill/select literals that match `inputValues` are rewritten.
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
 *
 * Already-parameterized `{ input }` refs are left alone. Navigate/click/read
 * never carry a typed input value, so they pass through.
 *
 * @param action - One success-path action before semantic locator cleanup
 * @param inputValues - Name → observed literal, from the compile request
 * @returns A new action when a literal matched; otherwise `action`
 */
export function parameterizeAction(
  action: CapabilityAction,
  inputValues: Record<string, DiscoveredInput>,
): CapabilityAction {
  if (action.type !== "fill" && action.type !== "select") {
    return action;
  }
  // Caller already supplied a ValueRef; do not second-guess it.
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
 *
 * Specs in `inputValues` that never matched a fill/select are omitted so the
 * artifact does not advertise unused inputs.
 *
 * @param actions - Already-parameterized success-path actions
 * @param inputValues - Same map passed to {@link parameterizeAction}
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
    // A stray `{ input }` with no compile-time spec is skipped, not invented.
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

/**
 * First matching name wins. Compare as strings so numeric literals still bind.
 */
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
