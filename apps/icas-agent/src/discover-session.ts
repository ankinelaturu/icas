/**
 * @file Wire DiscoveryAgent + CapabilityCompiler for `icas-agent discover`.
 *
 * This app always discovers. It must not silently replay a stored capability
 * or infer vendor / product / tenant from `--url`. First success writes the
 * base artifact and a header-only tenant override. An existing `--id` is
 * refused; there is no version-bump path in this prototype.
 */

import { randomUUID } from "node:crypto";

import { PlaywrightSurface } from "@icas/browser";
import type { CapabilityArtifact, CapabilityRegistry } from "@icas/capability";
import {
  CapabilityCompiler,
  DiscoveryAgent,
  createConfiguredDiscoveryProposer,
  hasDiscoveryApiKey,
  type CandidateProposer,
  type DiscoveryRequest,
  type DiscoveryResult,
} from "@icas/discovery";
import { FileSystemEvidenceWriter } from "@icas/evidence";
import { createRedactor } from "@icas/redactor";

import { CliHandoffController } from "./cli-handoff.js";
import { policyGuardForUrl } from "./default-policy.js";
import { evidenceRoot } from "./evidence-root.js";

/**
 * Parsed `icas-agent discover` invocation.
 *
 * Identity fields are never taken from `url`. An existing `id` is refused.
 */
export interface DiscoverRequest {
  id: string;
  url: string;
  goal: string;
  tenant: string;
  vendor: string;
  product: string;
  name?: string;
  headed: boolean;
}

/**
 * Collaborators for one discover run.
 */
export interface DiscoverSessionDeps {
  registry: CapabilityRegistry;
  /** Injected so unit tests never launch Chromium or Mastra. */
  runDiscovery?: (request: DiscoveryRequest) => Promise<DiscoveryResult>;
  proposer?: CandidateProposer;
  evidenceRoot?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  /** Live progress (stderr). Wired by the CLI; tests usually omit it. */
  log?: (line: string) => void;
}

/**
 * Refuse an existing id, then discover and persist base + header-only override.
 *
 * @param request - CLI identity + goal
 * @param deps - Catalog and optional test double for the live search
 */
export async function runDiscover(
  request: DiscoverRequest,
  deps: DiscoverSessionDeps,
): Promise<{ artifact: CapabilityArtifact; result: DiscoveryResult }> {
  const existing = await deps.registry.get(request.id);
  if (existing !== undefined) {
    throw new Error(
      `capability "${request.id}" already exists; choose a new --id`,
    );
  }

  const discoveryRequest: DiscoveryRequest = {
    id: request.id,
    goal: request.goal,
    target: {
      vendor: request.vendor,
      product: request.product,
      tenant: request.tenant,
      url: request.url,
    },
  };
  const result =
    deps.runDiscovery === undefined
      ? await executeLiveDiscovery(discoveryRequest, request, deps)
      : await deps.runDiscovery(discoveryRequest);
  if (result.status !== "success") {
    throw new Error(
      `discovery ${result.status}${result.reason === undefined ? "" : `: ${result.reason}`} (runId=${result.runId})`,
    );
  }
  const artifact = await new CapabilityCompiler().compile({
    id: request.id,
    target: {
      vendor: request.vendor,
      product: request.product,
      tenant: request.tenant,
      url: request.url,
    },
    events: result.events,
    registry: deps.registry,
    runId: result.runId,
    ...(request.name === undefined ? {} : { name: request.name }),
  });
  return { artifact, result };
}

/**
 * Open Playwright and run {@link DiscoveryAgent} with Mastra (or an injected proposer).
 *
 * @param discoveryRequest - Agent search input
 * @param request - CLI flags including headed
 * @param deps - Evidence root and optional proposer
 */
async function executeLiveDiscovery(
  discoveryRequest: DiscoveryRequest,
  request: DiscoverRequest,
  deps: DiscoverSessionDeps,
): Promise<DiscoveryResult> {
  const env = deps.env ?? process.env;
  const log = deps.log;
  const proposer =
    deps.proposer ??
    (await createLiveProposer(env, log));
  // Create evidence first with this id so JSONL and agent.run share one folder.
  const runId = randomUUID();
  const evidence = new FileSystemEvidenceWriter({
    root: deps.evidenceRoot ?? evidenceRoot(env),
    capabilityId: request.id,
    runId,
    runType: "discovery",
    redactor: createRedactor("evidence"),
  });
  log?.(`evidence ${evidence.runDirectory()}`);
  const policy = policyGuardForUrl(request.url);
  const handoff = new CliHandoffController({
    stdin: deps.stdin ?? process.stdin,
    ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
  });
  const surface = new PlaywrightSurface({ headed: request.headed });
  try {
    const agent = new DiscoveryAgent(surface, {
      proposer,
      policy,
      evidence,
      handoff,
      ...(log === undefined ? {} : { log }),
    });
    return await agent.run({ ...discoveryRequest, runId });
  } finally {
    // Close Chromium even when search fails. A stuck run must not leak the process.
    await surface.close();
  }
}

/**
 * Production Mastra proposer. Missing API keys fail closed.
 *
 * @param env - Process env
 * @param log - Optional stderr sink for raw LLM JSON
 */
async function createLiveProposer(
  env: NodeJS.ProcessEnv,
  log?: (line: string) => void,
): Promise<CandidateProposer> {
  if (!hasDiscoveryApiKey(env)) {
    throw new Error(
      "icas-agent discover requires ICAS_DISCOVERY_LLM_API_KEY or ICAS_DISCOVERY_LLM_BASE_URL",
    );
  }
  const configured = await createConfiguredDiscoveryProposer({
    env,
    ...(log === undefined ? {} : { log }),
  });
  return configured.proposer;
}
