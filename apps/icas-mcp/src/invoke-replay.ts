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
import { ReplayEngine, type ExecutionResult } from "@icas/replay";

import { CliHandoffController } from "./cli-handoff.js";
import { policyGuardForUrl } from "./default-policy.js";
import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import { evidenceRoot } from "./evidence-root.js";

/**
 * Arguments for one tool invocation.
 */
export interface McpInvokeRequest {
  capabilityId: string;
  url: string;
  tenant: string;
  /** Must match `capability.target.vendor`. Defaults to `icas-bank`. */
  vendor?: string;
  /** Must match `capability.target.product`. Defaults to `icas-bank`. */
  product?: string;
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
  const vendor = nonemptyIdentity(request.vendor);
  const product = nonemptyIdentity(request.product);
  const resolver = new CapabilityResolver(deps.registry);
  const capability = await resolver.resolve({
    id: request.capabilityId,
    tenant,
  });
  if (
    capability.target.vendor !== vendor ||
    capability.target.product !== product
  ) {
    throw new Error(
      `capability target is ${capability.target.vendor}/${capability.target.product}, not ${vendor}/${product}`,
    );
  }
  validateInputValues(capability.inputs, request.inputs);
  const normalized: McpInvokeRequest = { ...request, tenant, vendor, product };
  if (deps.executeReplay !== undefined) {
    return await deps.executeReplay({ capability, request: normalized });
  }
  return await executePlaywrightReplay(capability, normalized, deps);
}

/**
 * Treat missing or empty identity the same as the catalog default.
 *
 * @param value - Tool arg or omitted field
 */
function nonemptyIdentity(value: string | undefined): string {
  return value !== undefined && value.length > 0 ? value : DEFAULT_ICAS_IDENTITY;
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
  const surface = new PlaywrightSurface({ headed });
  try {
    await surface.open(request.url);
    const engine = new ReplayEngine(surface, { policy, evidence, handoff });
    const result = await engine.run(capability, request.inputs, { runId });
    return result;
  } finally {
    // Close Chromium even when invoke fails. Stdio MCP must not leak the process.
    await surface.close();
  }
}
