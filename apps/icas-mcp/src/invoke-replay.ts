/**
 * @file MCP invoke → CapabilityResolver + ReplayEngine.
 *
 * Same enrolled-replay path as icas-play. This module must not glob the
 * catalog or duplicate locator logic. MCP defaults to headless Chromium
 * because stdout is the protocol byte stream.
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
import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import { evidenceRoot } from "./evidence-root.js";
import {
  createConfiguredRepairProposer,
  hasRepairApiKey,
  resolveRepairModel,
} from "./mastra-repair-proposer.js";

/**
 * Arguments for one tool invocation.
 */
export interface McpInvokeRequest {
  capabilityId: string;
  url: string;
  tenant: string;
  /** Must match `capability.target.vendor`. Omitted uses the artifact target. */
  vendor?: string;
  /** Must match `capability.target.product`. Omitted uses the artifact target. */
  product?: string;
  /**
   * One bounded LLM repair. Default false. Uses `ICAS_ASSIST_LLM_*`, not tool
   * args. Does not persist an override.
   */
  assist?: boolean;
  inputs: Record<string, unknown>;
  headed?: boolean;
}

export interface McpInvokeDeps {
  registry: CapabilityRegistry;
  executeReplay?: (args: {
    capability: CapabilityArtifact;
    request: McpInvokeRequest;
  }) => Promise<ExecutionResult>;
  evidenceRoot?: string;
  /** Injected proposer for tests. Production builds Mastra when `assist`. */
  repair?: RepairProposer;
  /** Process env for `ICAS_ASSIST_LLM_*`; tests inject a stub. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the enrolled tenant and run ReplayEngine.
 *
 * Missing override throws from {@link CapabilityResolver}. `url` only opens
 * the surface. `vendor` / `product` must match the artifact target; they are
 * not inferred from `url`.
 *
 * @param request - Tool args after Zod parse
 * @param deps - Catalog and optional test double
 */
export async function invokeMcpCapability(
  request: McpInvokeRequest,
  deps: McpInvokeDeps,
): Promise<ExecutionResult> {
  const tenant = nonemptyIdentity(request.tenant);
  const resolver = new CapabilityResolver(deps.registry);
  const capability = await resolver.resolve({
    id: request.capabilityId,
    tenant,
  });
  // Omitted vendor/product take this artifact's target so Helix omit matches.
  const vendor = nonemptyIdentity(request.vendor, capability.target.vendor);
  const product = nonemptyIdentity(request.product, capability.target.product);
  if (
    capability.target.vendor !== vendor ||
    capability.target.product !== product
  ) {
    throw new Error(
      `capability target is ${capability.target.vendor}/${capability.target.product}, not ${vendor}/${product}`,
    );
  }
  validateInputValues(capability.inputs, request.inputs);
  const assist = request.assist === true;
  const normalized: McpInvokeRequest = {
    ...request,
    tenant,
    vendor,
    product,
    assist,
  };
  if (deps.executeReplay !== undefined) {
    return await deps.executeReplay({ capability, request: normalized });
  }
  return await executePlaywrightReplay(capability, normalized, deps);
}

/**
 * Treat missing or empty identity as `fallback`.
 *
 * Tenant omit still uses {@link DEFAULT_ICAS_IDENTITY} because resolve runs
 * before the artifact is loaded. Vendor/product omit uses `capability.target`.
 *
 * @param value - Tool arg or omitted field
 * @param fallback - Value when `value` is empty
 */
function nonemptyIdentity(
  value: string | undefined,
  fallback: string = DEFAULT_ICAS_IDENTITY,
): string {
  return value !== undefined && value.length > 0 ? value : fallback;
}

async function executePlaywrightReplay(
  capability: CapabilityArtifact,
  request: McpInvokeRequest,
  deps: McpInvokeDeps,
): Promise<ExecutionResult> {
  const runId = randomUUID();
  const evidence = new FileSystemEvidenceWriter({
    root: deps.evidenceRoot ?? evidenceRoot(),
    capabilityId: capability.id,
    runId,
    runType: "replay",
    redactor: createRedactor("evidence"),
  });
  const policy = policyGuardForUrl(request.url);
  const handoff = new CliHandoffController({ stdin: process.stdin });
  // MCP stdio owns stdout. Do not open a headed window by default.
  const headed = request.headed === true;
  const assist = request.assist === true;
  const repair = await resolveRepairProposer(request, deps);
  const surface = new PlaywrightSurface({ headed });
  try {
    await surface.open(request.url);
    const engine = new ReplayEngine(surface, {
      policy,
      evidence,
      handoff,
      ...(assist && repair !== undefined ? { repair } : {}),
    });
    const result = await engine.run(capability, request.inputs, {
      assist,
      runId,
    });
    return result;
  } finally {
    // Close Chromium even when invoke fails. Stdio MCP must not leak the process.
    await surface.close();
  }
}

/**
 * Inject Mastra repair only when `assist` is set and the caller did not
 * supply a proposer. Missing API keys fail closed. Log on stderr — stdout is
 * the MCP byte stream.
 *
 * @param request - Tool args including `assist`
 * @param deps - Optional injected proposer
 */
async function resolveRepairProposer(
  request: McpInvokeRequest,
  deps: McpInvokeDeps,
): Promise<RepairProposer | undefined> {
  if (request.assist !== true) {
    return undefined;
  }
  if (deps.repair !== undefined) {
    return deps.repair;
  }
  const env = deps.env ?? process.env;
  if (!hasRepairApiKey(env)) {
    throw new Error(
      "assist requires ICAS_ASSIST_LLM_API_KEY or ICAS_ASSIST_LLM_BASE_URL",
    );
  }
  const configured = await createConfiguredRepairProposer({
    model: resolveRepairModel(env),
    env,
    log: (line) => {
      console.error(line);
    },
  });
  return configured.proposer;
}
