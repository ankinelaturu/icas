/**
 * @file Build a CapabilityOverride from a guarded-replay report.
 *
 * Compatible → header-only (`createdBy: "verified"`).
 * Mismatch → one-step declarative patch (`createdBy: "icas-adapt"`).
 * Never writes executable JavaScript.
 */

import type {
  CapabilityArtifact,
  CapabilityOverride,
  CapabilityStep,
  StepOverride,
} from "@icas/capability";
import type { GuardedReplayReport } from "@icas/replay";

/** One step replace is bounded. Extra inserts accumulate a brittle patch. */
export const MAX_ADAPT_PATCH_STEPS = 1;

/**
 * Propose a declarative patch for the single divergent step.
 *
 * Production injects a Mastra-backed implementation. Tests inject a stub so
 * catalog writes stay deterministic.
 */
export interface StepSpecializer {
  specialize(args: {
    step: CapabilityStep;
    report: Extract<GuardedReplayReport, { status: "mismatch" }>;
  }): Promise<StepOverride>;
}

/**
 * Construct the override document. Does not persist it.
 *
 * @param args.base - Vendor+Product artifact that was replayed
 * @param args.tenant - New tenant id (required; never inferred)
 * @param args.report - Guarded replay classification
 * @param args.specializer - Required when `report.status` is `mismatch`
 */
export async function buildAdaptOverride(args: {
  base: CapabilityArtifact;
  tenant: string;
  report: GuardedReplayReport;
  specializer?: StepSpecializer;
}): Promise<CapabilityOverride> {
  const pin = `${args.base.id}@${args.base.capabilityVersion}`;
  const runId =
    args.report.status === "mismatch"
      ? args.report.result.runId
      : args.report.result.runId;

  if (args.report.status === "compatible") {
    return {
      schemaVersion: "1.0",
      id: `${args.base.id}-${args.tenant}`,
      baseCapability: pin,
      target: { tenant: args.tenant },
      overrides: {},
      provenance: {
        createdBy: "verified",
        createdFromRun: runId,
        reason: "base capability checkpoints passed on this tenant",
      },
    };
  }

  if (args.report.status === "business_outcome") {
    throw new Error(
      `adaptation aborted: business outcome ${args.report.result.outcome} is not a UI drift patch`,
    );
  }

  const mismatch = args.report;
  if (mismatch.result.stepId === undefined) {
    throw new Error(
      "adaptation aborted: checkpoints failed after the last step; rediscover the flow",
    );
  }
  if (args.specializer === undefined) {
    throw new Error(
      `step "${mismatch.stepId}" diverged (${mismatch.result.code}); bounded specialization requires a StepSpecializer`,
    );
  }

  const step = args.base.steps.find((candidate) => candidate.id === mismatch.stepId);
  if (step === undefined) {
    throw new Error(`divergent step "${mismatch.stepId}" is not on the base capability`);
  }

  const patch = await args.specializer.specialize({ step, report: mismatch });
  const override: CapabilityOverride = {
    schemaVersion: "1.0",
    id: `${args.base.id}-${args.tenant}`,
    baseCapability: pin,
    target: { tenant: args.tenant },
    overrides: {
      steps: {
        [mismatch.stepId]: patch,
      },
    },
    provenance: {
      createdBy: "icas-adapt",
      createdFromRun: runId,
      reason: `step ${mismatch.stepId} ${mismatch.result.code}`,
    },
  };
  assertBoundedAdaptPatch(override);
  return override;
}

/**
 * Refuse a patch that would rewrite most of the workflow.
 *
 * Header-only `overrides: {}` is always bounded. More than one step replace,
 * any insert, or disabled steps means rediscover instead of stacking locators.
 *
 * @param override - Candidate enrollment document
 * @throws {Error} When the patch is too large
 */
export function assertBoundedAdaptPatch(override: CapabilityOverride): void {
  const patch = override.overrides;
  const stepKeys = Object.keys(patch.steps ?? {});
  const inserted = [
    ...Object.values(patch.insertBefore ?? {}).flat(),
    ...Object.values(patch.insertAfter ?? {}).flat(),
  ];
  const disabled = patch.disabledSteps?.length ?? 0;
  if (
    stepKeys.length > MAX_ADAPT_PATCH_STEPS ||
    inserted.length > 0 ||
    disabled > 0
  ) {
    throw new Error(
      "adaptation aborted: divergence is too large; rediscover instead of accumulating a brittle patch",
    );
  }
}
