/**
 * @file Wire DiscoveryAgent + CapabilityCompiler for `icas-agent discover`.
 *
 * This app always discovers. It must not silently replay a stored capability
 * or infer vendor / product / tenant from `--url`. First success writes the
 * base artifact and a header-only tenant override.
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
 * Identity fields are never taken from `url`. `capabilityVersion` omitted
 * means `1.0.0` only when the id is new; an existing id requires an explicit bump.
 */
export interface DiscoverRequest {
  id: string;
  url: string;
  goal: string;
  tenant: string;
  vendor: string;
  product: string;
  name?: string;
  capabilityVersion?: string;
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
 * Refuse an existing id unless `--capability-version` is explicit, then discover
 * and persist base + header-only override.
 *
 * @param request - CLI identity + goal
 * @param deps - Catalog and optional test double for the live search
 */
export async function runDiscover(
  request: DiscoverRequest,
  deps: DiscoverSessionDeps,
): Promise<{ artifact: CapabilityArtifact; result: DiscoveryResult }> {
  const existing = await deps.registry.get(request.id);
  if (existing !== undefined && request.capabilityVersion === undefined) {
    throw new Error(
      `capability "${request.id}" already exists at ${existing.capabilityVersion}; pass --capability-version to bump`,
    );
  }
  const version = request.capabilityVersion ?? "1.0.0";
  const sameVersion = await deps.registry.get(request.id, version);
  if (sameVersion !== undefined) {
    throw new Error(
      `capability ${request.id}@${version} already exists; bump --capability-version`,
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
    capabilityVersion: version,
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
    throw new Error("icas-agent discover requires OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }
  const configured = await createConfiguredDiscoveryProposer(
    log === undefined ? {} : { log },
  );
  return configured.proposer;
}
