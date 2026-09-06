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
  /** Must match `capability.target.vendor`. Omitted uses the artifact target. */
  vendor?: string;
  /** Must match `capability.target.product`. Omitted uses the artifact target. */
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
  const normalized: McpInvokeRequest = { ...request, tenant, vendor, product };
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
