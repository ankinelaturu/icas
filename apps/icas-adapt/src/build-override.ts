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
  return {
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
}
