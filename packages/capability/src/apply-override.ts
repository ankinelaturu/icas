/**
 * @file applyCapabilityOverride — merge a declarative tenant patch onto a base artifact.
 */

import type { CapabilityArtifact, CapabilityStep } from "./artifact.js";
import type { CapabilityOverride, StepOverride } from "./capability-override.js";

/**
 * Return a new artifact with whole-step replacements from `override` applied.
 *
 * Header-only `overrides: {}` returns a clone of `base`. Partial field patches,
 * inserts, and disables are applied by later resolver passes.
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
  effective.steps = effective.steps.map((step) => {
    const patch = stepPatches[step.id];
    if (patch === undefined) {
      return step;
    }
    return applyWholeStepReplace(step, patch);
  });
  return effective;
}

function applyWholeStepReplace(
  step: CapabilityStep,
  patch: StepOverride,
): CapabilityStep {
  if (patch.step !== undefined) {
    return structuredClone(patch.step);
  }
  return step;
}
