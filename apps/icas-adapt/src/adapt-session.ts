/**
 * @file Guarded replay of a Vendor+Product base against a new tenant URL.
 *
 * Loads the base artifact (not an enrolled resolve). ReplayEngine stops at the
 * first checkpoint mismatch. Compatible enrollments write a header-only override
 * (`createdBy: "verified"`). A one-step mismatch writes `createdBy: "icas-adapt"`.
 */

import { randomUUID } from "node:crypto";

import { PlaywrightSurface } from "@icas/browser";
import type {
  CapabilityArtifact,
  CapabilityOverride,
  CapabilityRegistry,
} from "@icas/capability";
import { validateInputValues } from "@icas/capability";
import { FileSystemEvidenceWriter } from "@icas/evidence";
import { createRedactor } from "@icas/redactor";
import {
  classifyGuardedReplay,
  ReplayEngine,
  type ExecutionResult,
  type GuardedReplayReport,
} from "@icas/replay";

import { buildAdaptOverride, type StepSpecializer } from "./build-override.js";

import { CliHandoffController } from "./cli-handoff.js";
import { policyGuardForUrl } from "./default-policy.js";
import { evidenceRoot } from "./evidence-root.js";

/**
 * Parsed `icas-adapt` invocation. `--tenant` is required; never defaulted.
 */
export interface AdaptRunRequest {
  id: string;
  url: string;
  tenant: string;
  vendor: string;
  product: string;
  version?: string;
  inputs: Record<string, unknown>;
  headed: boolean;
  runId?: string;
}

export interface AdaptReplayInvocation {
  capability: CapabilityArtifact;
  request: AdaptRunRequest;
}

export interface AdaptSessionDeps {
  registry: CapabilityRegistry;
  executeReplay?: (invocation: AdaptReplayInvocation) => Promise<ExecutionResult>;
  /** Required to persist a mismatch patch; header-only compatible enrollments skip it. */
  specializer?: StepSpecializer;
  /** When false, report only (tests). Default true. */
  persistOverride?: boolean;
  evidenceRoot?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

/**
 * Replay the base capability against `--url` and classify the first stop.
 *
 * Do not call {@link CapabilityResolver}: the new tenant is not enrolled yet.
 *
 * @returns Guarded report plus the base artifact (and override when persisted)
 */
export async function runGuardedAdapt(
  request: AdaptRunRequest,
  deps: AdaptSessionDeps,
): Promise<{
  report: GuardedReplayReport;
  capability: CapabilityArtifact;
  override?: CapabilityOverride;
}> {
  const base =
    request.version === undefined
      ? await deps.registry.get(request.id)
      : await deps.registry.get(request.id, request.version);
  if (base === undefined) {
    throw new Error(`capability "${request.id}" is not in the catalog`);
  }
  if (
    base.target.vendor !== request.vendor ||
    base.target.product !== request.product
  ) {
    throw new Error(
      `capability target is ${base.target.vendor}/${base.target.product}, not ${request.vendor}/${request.product}`,
    );
  }
  validateInputValues(base.inputs, request.inputs);
  const invocation: AdaptReplayInvocation = { capability: base, request };
  const result =
    deps.executeReplay === undefined
      ? await executePlaywrightReplay(invocation, deps)
      : await deps.executeReplay(invocation);
  const report = classifyGuardedReplay(result);
  if (deps.persistOverride === false) {
    return { report, capability: base };
  }
  const override = await buildAdaptOverride({
    base,
    tenant: request.tenant,
    report,
    ...(deps.specializer === undefined ? {} : { specializer: deps.specializer }),
  });
  await deps.registry.saveOverride(override);
  return { report, capability: base, override };
}

/**
 * Open Playwright and run ReplayEngine on the base artifact (no LLM).
 */
async function executePlaywrightReplay(
  invocation: AdaptReplayInvocation,
  deps: AdaptSessionDeps,
): Promise<ExecutionResult> {
  const { capability, request } = invocation;
  const runId = request.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const evidence = new FileSystemEvidenceWriter({
    root: deps.evidenceRoot ?? evidenceRoot(),
    capabilityId: capability.id,
    runId,
    runType: "adaptation",
    redactor: createRedactor("evidence"),
  });
  const policy = policyGuardForUrl(request.url);
  const handoff = new CliHandoffController({
    stdin: deps.stdin ?? process.stdin,
    ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
  });
  const surface = new PlaywrightSurface({ headed: request.headed });
  try {
    await surface.open(request.url);
    const engine = new ReplayEngine(surface, { policy, evidence, handoff });
    const result = await engine.run(capability, request.inputs, { runId });
    if (result.status !== "failure") {
      await evidence.writeSummary({
        runId: result.runId,
        runType: "adaptation",
        capabilityId: result.capabilityId,
        status: result.status,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    }
    return result;
  } finally {
    await surface.close();
  }
}
