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
import {
  NEXT_ACTION_TARGET_MISSING,
  type GuardedReplayReport,
} from "@icas/replay";

/** One step replace is bounded. Extra inserts accumulate a brittle patch. */
export const MAX_ADAPT_PATCH_STEPS = 1;

/**
 * Propose a declarative patch for the single divergent step.
 *
 * `icas-adapt` injects a Mastra-backed specializer when `ICAS_ADAPT_LLM_*`
 * is ready. Tests inject a stub so catalog writes stay deterministic.
 * Compatible enrollments never call this.
 */
export interface StepSpecializer {
  specialize(args: {
    step: CapabilityStep;
    report: Extract<GuardedReplayReport, { status: "mismatch" }>;
    /** Visible body text at the miss. Empty when a stub did not observe a page. */
    pageText: string;
  }): Promise<StepOverride>;
}

/**
 * Construct the override document. Does not persist it.
 *
 * @param args.base - Vendor+Product artifact that was replayed
 * @param args.tenant - New tenant id (required; never inferred)
 * @param args.report - Guarded replay classification
 * @param args.specializer - Required when `report.status` is `mismatch`
 * @param args.pageText - Visible body text at the miss; ignored on compatible
 */
export async function buildAdaptOverride(args: {
  base: CapabilityArtifact;
  tenant: string;
  report: GuardedReplayReport;
  specializer?: StepSpecializer;
  pageText?: string;
}): Promise<CapabilityOverride> {
  const pin = args.base.id;
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
      `step "${mismatch.stepId}" diverged (${mismatch.result.code}); bounded specialization requires a StepSpecializer (set ICAS_ADAPT_LLM_API_KEY or ICAS_ADAPT_LLM_BASE_URL)`,
    );
  }

  const step = resolveDivergentStep(args.base, mismatch);

  const patch = await args.specializer.specialize({
    step,
    report: { ...mismatch, stepId: step.id },
    pageText: args.pageText ?? "",
  });
  const override: CapabilityOverride = {
    schemaVersion: "1.0",
    id: `${args.base.id}-${args.tenant}`,
    baseCapability: pin,
    target: { tenant: args.tenant },
    overrides: {
      steps: {
        [step.id]: patch,
      },
    },
    provenance: {
      createdBy: "icas-adapt",
      createdFromRun: runId,
      reason: `step ${step.id} ${mismatch.result.code}`,
    },
  };
  assertBoundedAdaptPatch(override);
  return override;
}

/**
 * Step whose locator actually drifted.
 *
 * After a successful fill, replay probes the next click. An unclassified miss
 * used to name the fill (`fill-ln-acct`) while `expected` was the Inquire
 * button. Patch the step that owns that action so Inquire → Look Up is a
 * one-step override, not a no-op retarget of a field that already matched.
 *
 * @param base - Vendor+Product artifact
 * @param mismatch - Guarded mismatch (may still name the prior step)
 * @returns The step to specialize
 * @throws {Error} When neither `stepId` nor `expected` maps onto the base
 */
export function resolveDivergentStep(
  base: CapabilityArtifact,
  mismatch: Extract<GuardedReplayReport, { status: "mismatch" }>,
): CapabilityStep {
  const named =
    mismatch.result.stepId === undefined
      ? undefined
      : base.steps.find((candidate) => candidate.id === mismatch.result.stepId);
  if (mismatch.observed === NEXT_ACTION_TARGET_MISSING) {
    const byAction = stepMatchingAction(base, mismatch.expected);
    if (byAction !== undefined) {
      return byAction;
    }
    const following =
      mismatch.result.stepId === undefined
        ? undefined
        : stepAfter(base, mismatch.result.stepId);
    if (following !== undefined) {
      return following;
    }
  }
  if (named === undefined) {
    throw new Error(`divergent step "${mismatch.stepId}" is not on the base capability`);
  }
  return named;
}

/**
 * Find a step whose catalog action equals `expected`.
 *
 * @param base - Artifact
 * @param expected - Replay `expected` (often the next {@link CapabilityAction})
 */
function stepMatchingAction(
  base: CapabilityArtifact,
  expected: unknown,
): CapabilityStep | undefined {
  if (expected === null || typeof expected !== "object") {
    return undefined;
  }
  const encoded = JSON.stringify(expected);
  return base.steps.find((candidate) => JSON.stringify(candidate.action) === encoded);
}

/**
 * Step after `stepId` in catalog order.
 *
 * @param base - Artifact
 * @param stepId - Current step
 */
function stepAfter(base: CapabilityArtifact, stepId: string): CapabilityStep | undefined {
  const index = base.steps.findIndex((candidate) => candidate.id === stepId);
  if (index < 0) {
    return undefined;
  }
  return base.steps[index + 1];
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
