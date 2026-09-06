/**
 * @file Guarded replay of a Vendor+Product base against a new tenant URL.
 *
 * Loads the base artifact (not an enrolled resolve). ReplayEngine stops at the
 * first checkpoint mismatch. Compatible enrollments write a header-only override
 * (`createdBy: "verified"`). A one-step mismatch writes `createdBy: "icas-adapt"`.
 * Enrollment is kept only when a second ReplayEngine run of the resolved
 * effective capability passes every checkpoint. The CLI logger prints each
 * phase so a rollback includes the miss, the patch, and the re-verify stop.
 */

import { randomUUID } from "node:crypto";

import { PlaywrightSurface } from "@icas/browser";
import type {
  CapabilityArtifact,
  CapabilityOverride,
  CapabilityRegistry,
} from "@icas/capability";
import { CapabilityResolver, validateInputValues } from "@icas/capability";
import { FileSystemEvidenceWriter } from "@icas/evidence";
import { createRedactor } from "@icas/redactor";
import {
  classifyGuardedReplay,
  ReplayEngine,
  type ExecutionResult,
  type GuardedReplayReport,
} from "@icas/replay";

import { buildAdaptOverride, resolveDivergentStep, type StepSpecializer } from "./build-override.js";
import { CliHandoffController } from "./cli-handoff.js";
import { policyGuardForUrl } from "./default-policy.js";
import { evidenceRoot } from "./evidence-root.js";
import {
  AdaptReverifyError,
  formatGuardedReplayReport,
  formatOverrideSummary,
  formatPageTextPreview,
} from "./format-adapt-log.js";

/**
 * Parsed `icas-adapt` invocation. `--tenant` is required; never defaulted.
 */
export interface AdaptRunRequest {
  id: string;
  url: string;
  tenant: string;
  vendor: string;
  product: string;
  inputs: Record<string, unknown>;
  headed: boolean;
  runId?: string;
  /** Locator wait budget in ms. Tests pass a small value; production defaults inside PlaywrightSurface. */
  timeoutMs?: number;
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
  /**
   * Visible page text for a stubbed mismatch. Production Playwright capture
   * ignores this and reads the live document after a failed run.
   */
  pageText?: string;
  /** When false, report only (tests). Default true. */
  persistOverride?: boolean;
  evidenceRoot?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  /** Stage lines for the CLI. Tests capture these as stdout. */
  log?: (line: string) => void;
}

/**
 * Replay result plus optional page text for the specializer.
 *
 * Compatible runs leave `pageText` empty. Mismatch needs the chrome the
 * operator can see so the model can propose a locator synonym.
 */
interface ReplayCapture {
  result: ExecutionResult;
  pageText: string;
  evidenceDir?: string;
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
  reverify?: ExecutionResult;
}> {
  const base = await deps.registry.get(request.id);
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
  emit(deps, `adapt: ${request.id} tenant=${request.tenant} url=${request.url}`);
  emit(deps, `inputs: ${JSON.stringify(request.inputs, null, 2)}`);
  emit(deps, `vendor/product: ${request.vendor}/${request.product}`);
  emit(deps, `headed: ${String(request.headed)}`);
  emit(deps, "phase: guarded replay (base capability, no LLM)");
  const captured = await replayOnce(invocation, deps);
  const report = classifyGuardedReplay(captured.result);
  emit(deps, formatGuardedReplayReport(report, captured.evidenceDir));
  if (report.status === "mismatch") {
    const failed = resolveDivergentStep(base, report);
    emit(deps, `failed step definition:\n${JSON.stringify(failed, null, 2)}`);
    emit(deps, formatPageTextPreview(captured.pageText));
  }
  if (deps.persistOverride === false) {
    return { report, capability: base };
  }
  if (report.status === "mismatch") {
    emit(deps, "phase: StepSpecializer (one-step override)");
  } else if (report.status === "compatible") {
    emit(deps, "phase: header-only enrollment (createdBy: verified)");
  }
  const override = await buildAdaptOverride({
    base,
    tenant: request.tenant,
    report,
    pageText: captured.pageText,
    ...(deps.specializer === undefined ? {} : { specializer: deps.specializer }),
  });
  emit(deps, formatOverrideSummary(override));
  await deps.registry.saveOverride(override);
  emit(deps, `saved override for tenant ${request.tenant} capability ${base.id}`);
  emit(deps, "phase: re-verify (effective capability, no LLM)");
  const reverified = await reverifyOverride(request, base, deps);
  emit(deps, formatGuardedReplayReport(
    classifyGuardedReplay(reverified.result),
    reverified.evidenceDir,
  ));
  if (reverified.result.status !== "success") {
    await deps.registry.removeOverride(request.tenant, base.id);
    emit(deps, `rolled back override for tenant ${request.tenant} capability ${base.id}`);
    throw new AdaptReverifyError({
      tenant: request.tenant,
      reverify: reverified.result,
      ...(reverified.evidenceDir === undefined ? {} : { evidenceDir: reverified.evidenceDir }),
    });
  }
  return { report, capability: base, override, reverify: reverified.result };
}

/**
 * Resolve the just-written override and replay the effective capability.
 *
 * Header-only enrollment is proven the same way as a one-step patch. Failure
 * rolls back so `icas-play` cannot run an unverified tenant.
 *
 * @returns Capture of the second run (success keeps enrollment)
 */
async function reverifyOverride(
  request: AdaptRunRequest,
  base: CapabilityArtifact,
  deps: AdaptSessionDeps,
): Promise<ReplayCapture> {
  const effective = await new CapabilityResolver(deps.registry).resolve({
    id: base.id,
    tenant: request.tenant,
  });
  const invocation: AdaptReplayInvocation = { capability: effective, request };
  return replayOnce(invocation, deps);
}

/**
 * Write a stage line when the CLI injected a logger.
 *
 * @param deps - Session deps
 * @param line - One or more newline-separated lines
 */
function emit(deps: AdaptSessionDeps, text: string): void {
  if (deps.log === undefined) {
    return;
  }
  for (const line of text.split("\n")) {
    deps.log(line);
  }
}

/**
 * Run ReplayEngine once. Injected `executeReplay` skips Playwright.
 *
 * Stubbed runs use {@link AdaptSessionDeps.pageText} so unit tests can feed
 * chrome without a browser. Live runs capture `visibleText` after a failure,
 * before `surface.close()`.
 *
 * @param invocation - Artifact plus CLI request
 * @param deps - Registry, optional stub, evidence
 */
async function replayOnce(
  invocation: AdaptReplayInvocation,
  deps: AdaptSessionDeps,
): Promise<ReplayCapture> {
  if (deps.executeReplay !== undefined) {
    return {
      result: await deps.executeReplay(invocation),
      pageText: deps.pageText ?? "",
    };
  }
  return executePlaywrightReplay(invocation, deps);
}

/**
 * Open Playwright and run ReplayEngine on the artifact (no LLM).
 *
 * On failure, read visible text while the page is still open. Close always
 * runs in `finally` so a hung capture cannot leak Chromium.
 *
 * @param invocation - Artifact plus CLI request
 * @param deps - Evidence, policy, handoff streams
 */
async function executePlaywrightReplay(
  invocation: AdaptReplayInvocation,
  deps: AdaptSessionDeps,
): Promise<ReplayCapture> {
  const { capability, request } = invocation;
  const runId = request.runId ?? randomUUID();
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
  const surface = new PlaywrightSurface({
    headed: request.headed,
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
  });
    emit(
      deps,
      `browser: opening ${request.url} (${request.headed ? "headed" : "headless"}) runId=${runId}`,
    );
  try {
    await surface.open(request.url);
    const engine = new ReplayEngine(surface, { policy, evidence, handoff });
    const result = await engine.run(capability, request.inputs, { runId });
    let pageText = "";
    // Compatible success has nothing to specialize. Capture only on a miss
    // so the specializer sees the chrome that replaced the expected locator.
    if (result.status === "failure") {
      try {
        pageText = await surface.visibleText();
      } catch {
        pageText = "";
      }
    }
    return { result, pageText, evidenceDir: evidence.runDirectory() };
  } finally {
    await surface.close();
  }
}
