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
 * Missing override throws from {@link CapabilityResolver}. `--url` only opens
 * the surface.
 *
 * @param request - Tool args after Zod parse
 * @param deps - Catalog and optional test double
 */
export async function invokeMcpCapability(
  request: McpInvokeRequest,
  deps: McpInvokeDeps,
): Promise<ExecutionResult> {
  const tenant = request.tenant.length > 0 ? request.tenant : DEFAULT_ICAS_IDENTITY;
  const resolver = new CapabilityResolver(deps.registry);
  const capability = await resolver.resolve({
    id: request.capabilityId,
    tenant,
  });
  validateInputValues(capability.inputs, request.inputs);
  const normalized: McpInvokeRequest = { ...request, tenant };
  if (deps.executeReplay !== undefined) {
    return await deps.executeReplay({ capability, request: normalized });
  }
  return await executePlaywrightReplay(capability, normalized, deps);
}

async function executePlaywrightReplay(
  capability: CapabilityArtifact,
  request: McpInvokeRequest,
  deps: McpInvokeDeps,
): Promise<ExecutionResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
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
