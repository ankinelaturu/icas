/**
 * @file Wire CapabilityResolver + ReplayEngine for `icas-play run`.
 *
 * This module stays in the app. It must not glob the catalog or infer tenant
 * from `--url`. Strict replay is model-free. `--assist` injects a
 * {@link RepairProposer} here; ReplayEngine still ignores assist when repair
 * is missing.
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
import {
  createConfiguredRepairProposer,
  hasRepairApiKey,
  resolveRepairModel,
} from "./mastra-repair-proposer.js";

/**
 * Parsed `icas-play run` invocation. Identity fields are never taken from `url`.
 */
export interface PlayRunRequest {
  id: string;
  url: string;
  tenant: string;
  vendor: string;
  product: string;
  inputs: Record<string, unknown>;
  /** When true, ReplayEngine may invoke one bounded {@link RepairProposer}. */
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
  /** Repair proposer is unused unless `request.assist` is true. */
  repair?: RepairProposer;
  /** Process env for `--assist` API-key checks; tests inject a stub. */
  env?: NodeJS.ProcessEnv;
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
    // Tests skip Chromium and Mastra; they still see `request.assist`.
    return await deps.executeReplay(invocation);
  }
  const repair = await resolveRepairProposer(request, deps);
  return await executePlaywrightReplay(invocation, {
    ...deps,
    ...(repair === undefined ? {} : { repair }),
  });
}

/**
 * Inject Mastra repair only when `--assist` is set and the caller did not
 * supply a proposer. Missing API keys fail closed rather than silently
 * running a model-free replay.
 *
 * @param request - CLI flags including `assist`
 * @param deps - Optional injected proposer
 */
async function resolveRepairProposer(
  request: PlayRunRequest,
  deps: PlayReplaySessionDeps,
): Promise<RepairProposer | undefined> {
  if (!request.assist) {
    return undefined;
  }
  if (deps.repair !== undefined) {
    return deps.repair;
  }
  const env = deps.env ?? process.env;
  if (!hasRepairApiKey(env)) {
    throw new Error("--assist requires OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }
  const configured = await createConfiguredRepairProposer({
    model: resolveRepairModel(env),
  });
  return configured.proposer;
}

/**
 * Open Playwright, policy-gate, and run ReplayEngine.
 *
 * Strict replay (`assist: false`) never constructs a model client.
 * `--assist` may inject repair; ReplayEngine still policy-checks each action.
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
    // ReplayEngine writes log.jsonl + summary.json for every terminal status.
    return result;
  } finally {
    await surface.close();
  }
}
