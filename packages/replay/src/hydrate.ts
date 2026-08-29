/**
 * @file hydrate — resolve ValueRefs to literals before Surface.assert / execute.
 *
 * The Surface seam stays tenant-agnostic: it must not receive the input map.
 * Replay binds invocation params here so Playwright (or a future desktop
 * surface) only sees literals.
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
 *
 * Click/navigate/read have no bound value. Those actions pass through unchanged.
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

/**
 * Coerce a text assertion value to a string the surface can wait on.
 */
function hydrateText(
  value: string | ValueRef,
  inputs: Readonly<Record<string, unknown>>,
): string {
  if (typeof value === "string") {
    return value;
  }
  return stringify(resolveValueRef(value, inputs));
}

/**
 * Wrap the resolved value as `{ literal }` so a later execute against an empty
 * input map (PlaywrightSurface) does not try to re-resolve a `{ fromInput }`.
 */
function asLiteralRef(
  ref: ValueRef,
  inputs: Readonly<Record<string, unknown>>,
): ValueRef {
  return { literal: resolveValueRef(ref, inputs) };
}

/**
 * Stringify only primitives. Objects would JSON-dump into a fill and hide a
 * catalog/type error until the bank form rejected the text.
 */
function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("ValueRef must resolve to a string, number, or boolean");
}
