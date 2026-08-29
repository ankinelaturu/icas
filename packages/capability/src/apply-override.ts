/**
 * @file applyCapabilityOverride — merge a declarative tenant patch onto a base artifact.
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
 * @throws {Error} When a referenced step id is not on the base capability
 */
export function applyCapabilityOverride(
  base: CapabilityArtifact,
  override: CapabilityOverride,
): CapabilityArtifact {
  const effective = structuredClone(base);
  const patch = override.overrides;
  const knownIds = new Set(effective.steps.map((step) => step.id));
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

function assertKnownStepIds(knownIds: Set<string>, referenced: string[]): void {
  for (const stepId of referenced) {
    if (!knownIds.has(stepId)) {
      throw new Error(`unknown step id "${stepId}"`);
    }
  }
}

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
