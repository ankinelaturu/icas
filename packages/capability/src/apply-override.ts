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
 * Return a new artifact with tenant step patches applied.
 *
 * Header-only `overrides: {}` returns a clone of `base`. Inserts and disables
 * are applied by the insert/disable pass.
 *
 * @throws {Error} When a patched step id is not on the base capability
 */
export function applyCapabilityOverride(
  base: CapabilityArtifact,
  override: CapabilityOverride,
): CapabilityArtifact {
  const effective = structuredClone(base);
  const stepPatches = override.overrides.steps;
  if (stepPatches === undefined) {
    return effective;
  }
  for (const stepId of Object.keys(stepPatches)) {
    if (!effective.steps.some((step) => step.id === stepId)) {
      throw new Error(`unknown step id "${stepId}"`);
    }
  }
  effective.steps = effective.steps.map((step) => {
    const patch = stepPatches[step.id];
    if (patch === undefined) {
      return step;
    }
    return applyStepPatch(step, patch);
  });
  return effective;
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
