/**
 * @file hydrate — resolve ValueRefs to literals before Surface.assert / execute.
 */

import {
  resolveValueRef,
  type Assertion,
  type CapabilityAction,
  type ValueRef,
} from "@icas/capability";

/**
 * Replace ValueRefs in an assertion so the surface does not need the input map.
 */
export function hydrateAssertion(
  assertion: Assertion,
  inputs: Readonly<Record<string, unknown>>,
): Assertion {
  if (assertion.type === "textVisible" || assertion.type === "state") {
    return { ...assertion, value: hydrateText(assertion.value, inputs) };
  }
  if (assertion.type === "valueEquals") {
    return { ...assertion, value: asLiteralRef(assertion.value, inputs) };
  }
  return assertion;
}

/**
 * Replace ValueRefs on fill/select so {@link Surface.execute} receives literals.
 */
export function hydrateAction(
  action: CapabilityAction,
  inputs: Readonly<Record<string, unknown>>,
): CapabilityAction {
  if (action.type === "fill" || action.type === "select") {
    return { ...action, value: asLiteralRef(action.value, inputs) };
  }
  return action;
}

function hydrateText(
  value: string | ValueRef,
  inputs: Readonly<Record<string, unknown>>,
): string {
  if (typeof value === "string") {
    return value;
  }
  return stringify(resolveValueRef(value, inputs));
}

function asLiteralRef(
  ref: ValueRef,
  inputs: Readonly<Record<string, unknown>>,
): ValueRef {
  return { literal: resolveValueRef(ref, inputs) };
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("ValueRef must resolve to a string, number, or boolean");
}
