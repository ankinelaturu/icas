/**
 * @file Wire CapabilityResolver + ReplayEngine for `icas-play run`.
 *
 * This module stays in the app. It must not glob the catalog, infer tenant
 * from `--url`, or call an LLM. `ReplayEngine` receives the already-resolved
 * effective capability only.
 */

import { randomUUID } from "node:crypto";

import { PlaywrightSurface } from "@icas/browser";
import {
  CapabilityResolver,
  validateInputValues,
  type CapabilityArtifact,
  type CapabilityRegistry,
} from "@icas/capability";
import { FileSystemEvidenceWriter } from "@icas/evidence";
import { createRedactor } from "@icas/redactor";
import {
  ReplayEngine,
  type ExecutionResult,
  type RepairProposer,
} from "@icas/replay";

import { CliHandoffController } from "./cli-handoff.js";
import { policyGuardForUrl } from "./default-policy.js";
import { evidenceRoot } from "./evidence-root.js";

/**
 * Parsed `icas-play run` invocation. Identity fields are never taken from `url`.
 */
export interface PlayRunRequest {
  id: string;
  url: string;
  tenant: string;
  vendor: string;
  product: string;
  version?: string;
  inputs: Record<string, unknown>;
  /** Always false in strict replay; `--assist` is a later pass. */
  assist: boolean;
  headed: boolean;
  runId?: string;
}

/**
 * Collaborators for one production or test replay.
 */
export interface PlayReplaySessionDeps {
  registry: CapabilityRegistry;
  /** Injected so unit tests never launch Chromium. */
  executeReplay?: (invocation: PlayReplayInvocation) => Promise<ExecutionResult>;
  /** Repair proposer is unused until `--assist` is wired. */
  repair?: RepairProposer;
  evidenceRoot?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

/**
 * Resolved artifact plus the original CLI request.
 *
 * Tests assert enrollment happened (`capability` is effective) without a browser.
 */
export interface PlayReplayInvocation {
  capability: CapabilityArtifact;
  request: PlayRunRequest;
}

/**
 * Resolve the enrolled tenant, validate inputs, then run ReplayEngine.
 *
 * Missing override throws from {@link CapabilityResolver} (not enrolled).
 * `--vendor` / `--product` must match the artifact target; they are not
 * inferred from `--url`.
 *
 * @param request - CLI identity + typed inputs
 * @param deps - Catalog and optional test double for the browser session
 */
export async function runEnrolledReplay(
  request: PlayRunRequest,
  deps: PlayReplaySessionDeps,
): Promise<ExecutionResult> {
  const resolver = new CapabilityResolver(deps.registry);
  const capability = await resolver.resolve({
    id: request.id,
    tenant: request.tenant,
    ...(request.version === undefined ? {} : { version: request.version }),
  });
  if (
    capability.target.vendor !== request.vendor ||
    capability.target.product !== request.product
  ) {
    throw new Error(
      `capability target is ${capability.target.vendor}/${capability.target.product}, not ${request.vendor}/${request.product}`,
    );
  }
  validateInputValues(capability.inputs, request.inputs);
  const invocation: PlayReplayInvocation = { capability, request };
  if (deps.executeReplay !== undefined) {
    return await deps.executeReplay(invocation);
  }
  return await executePlaywrightReplay(invocation, deps);
}

/**
 * Open Playwright, policy-gate, and run ReplayEngine with no LLM.
 *
 * @param invocation - Effective capability plus CLI request
 * @param deps - Evidence root and stdin for HITL
 */
async function executePlaywrightReplay(
  invocation: PlayReplayInvocation,
  deps: PlayReplaySessionDeps,
): Promise<ExecutionResult> {
  const { capability, request } = invocation;
  const runId = request.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const evidence = new FileSystemEvidenceWriter({
    root: deps.evidenceRoot ?? evidenceRoot(),
    capabilityId: capability.id,
    runId,
    runType: "replay",
    redactor: createRedactor("evidence"),
  });
  const policy = policyGuardForUrl(request.url);
  const handoff = new CliHandoffController({
    stdin: deps.stdin ?? process.stdin,
    ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
  });
  const surface = new PlaywrightSurface({ headed: request.headed });
  try {
    // `--url` only opens the page. Tenant identity was already resolved above.
    await surface.open(request.url);
    const engine = new ReplayEngine(surface, {
      policy,
      evidence,
      handoff,
      ...(request.assist && deps.repair !== undefined ? { repair: deps.repair } : {}),
    });
    const result = await engine.run(capability, request.inputs, {
      assist: request.assist,
      runId,
    });
    // Failure evidence already wrote a summary. Success / business_outcome still need one.
    if (result.status !== "failure") {
      await evidence.writeSummary({
        runId: result.runId,
        runType: "replay",
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
