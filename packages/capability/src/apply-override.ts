/**
 * @file applyCapabilityOverride — merge a declarative tenant patch onto a base artifact.
 *
 * Produces an in-memory effective capability. Never writes to disk. Header-only
 * `overrides: {}` clones the base so enrollment does not require a real patch.
 */

import type {
  CapabilityAction,
  CapabilityArtifact,
  CapabilityStep,
  TargetDescriptor,
} from "./artifact.js";
import type { CapabilityOverride, StepOverride } from "./capability-override.js";

/**
 * Return a new artifact with tenant patches applied.
 *
 * Order: insert before/after known ids, then field/whole-step patches, then
 * disable. Header-only `overrides: {}` returns a clone of `base`.
 *
 * Insert first so later patches see the new neighbors. Disable last so a step
 * can be patched and then dropped in one override. Unknown ids throw rather
 * than skipping a typo.
 *
 * @param base - Vendor+Product artifact from the catalog
 * @param override - Enrolled tenant patch, possibly `overrides: {}`
 * @returns A new artifact; `base` is not mutated
 * @throws {Error} When a referenced step id is not on the base capability
 */
export function applyCapabilityOverride(
  base: CapabilityArtifact,
  override: CapabilityOverride,
): CapabilityArtifact {
  const effective = structuredClone(base);
  const patch = override.overrides;
  const knownIds = new Set(effective.steps.map((step) => step.id));
  // Only base ids are addressable. Inserted steps cannot be patched by a new id
  // in the same override; that keeps the patch key space equal to the catalog.
  assertKnownStepIds(knownIds, [
    ...Object.keys(patch.steps ?? {}),
    ...Object.keys(patch.insertBefore ?? {}),
    ...Object.keys(patch.insertAfter ?? {}),
    ...(patch.disabledSteps ?? []),
  ]);

  effective.steps = insertSteps(
    effective.steps,
    patch.insertBefore ?? {},
    patch.insertAfter ?? {},
  );

  const stepPatches = patch.steps ?? {};
  effective.steps = effective.steps.map((step) => {
    const stepPatch = stepPatches[step.id];
    if (stepPatch === undefined) {
      return step;
    }
    return applyStepPatch(step, stepPatch);
  });

  if (patch.disabledSteps !== undefined && patch.disabledSteps.length > 0) {
    const disabled = new Set(patch.disabledSteps);
    effective.steps = effective.steps.filter((step) => !disabled.has(step.id));
  }

  return effective;
}

/**
 * Refuse unknown step ids so a typo cannot silently no-op.
 *
 * @param knownIds - Step ids on the cloned base, before inserts
 * @param referenced - Ids named by steps / insertBefore / insertAfter / disabledSteps
 * @throws {Error} When any referenced id is missing from the base
 */
function assertKnownStepIds(knownIds: Set<string>, referenced: string[]): void {
  for (const stepId of referenced) {
    if (!knownIds.has(stepId)) {
      throw new Error(`unknown step id "${stepId}"`);
    }
  }
}

/**
 * Splice new steps around existing ones, keeping original order.
 *
 * For each base step, emit `insertBefore` clones, then the step, then
 * `insertAfter` clones. Clone so later field patches cannot mutate the
 * override JSON that still sits in the catalog.
 */
function insertSteps(
  steps: CapabilityStep[],
  insertBefore: Record<string, CapabilityStep[]>,
  insertAfter: Record<string, CapabilityStep[]>,
): CapabilityStep[] {
  const result: CapabilityStep[] = [];
  for (const step of steps) {
    const before = insertBefore[step.id];
    if (before !== undefined) {
      result.push(...structuredClone(before));
    }
    result.push(step);
    const after = insertAfter[step.id];
    if (after !== undefined) {
      result.push(...structuredClone(after));
    }
  }
  return result;
}

/**
 * Replace a whole step, or overlay individual fields.
 *
 * Whole-step `patch.step` returns immediately. Schema forbids combining it with
 * field patches; this early return is the runtime counterpart. `target` is
 * applied after `action` so a locator-only override still wins when both are
 * present (schema allows action+target together).
 */
function applyStepPatch(step: CapabilityStep, patch: StepOverride): CapabilityStep {
  if (patch.step !== undefined) {
    return structuredClone(patch.step);
  }
  const next = structuredClone(step);
  if (patch.action !== undefined) {
    next.action = structuredClone(patch.action);
  }
  if (patch.target !== undefined) {
    next.action = withTarget(next.action, structuredClone(patch.target), step.id);
  }
  if (patch.preconditions !== undefined) {
    next.preconditions = structuredClone(patch.preconditions);
  }
  if (patch.postconditions !== undefined) {
    next.postconditions = structuredClone(patch.postconditions);
  }
  return next;
}

/**
 * Attach a locator to an action that already has a `target` field.
 *
 * `navigate` and `handoff` have no target. Refuse rather than spreading a
 * bogus `target` onto those types (that would break the discriminated union).
 *
 * @throws {Error} When the action vocabulary has no locator to override
 */
function withTarget(
  action: CapabilityAction,
  target: TargetDescriptor,
  stepId: string,
): CapabilityAction {
  if (!("target" in action)) {
    throw new Error(
      `step "${stepId}" action "${action.type}" has no target to override`,
    );
  }
  return { ...action, target };
}
