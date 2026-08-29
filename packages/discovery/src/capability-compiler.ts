/**
 * @file CapabilityCompiler — trace → base artifact plus optional catalog persist.
 *
 * Failed exploration stays in the JSONL evidence. Checkpoints, outputs, and
 * Vendor+Product identity are derived from the success path.
 */

import { readFile } from "node:fs/promises";

import type {
  CapabilityArtifact,
  CapabilityRegistry,
  CapabilityStep,
} from "@icas/capability";

import {
  deriveCheckpoints,
  deriveOutputs,
  deriveSuccess,
  semanticAction,
  uniqueStepId,
} from "./derive-artifact.js";
import type { DiscoveryTraceEvent } from "./discovery-types.js";
import {
  extractSuccessfulPath,
  type SuccessfulPathStep,
} from "./extract-successful-path.js";
import {
  inputsFromActions,
  parameterizeAction,
  type DiscoveredInput,
} from "./parameterize-inputs.js";

export type { DiscoveredInput };

export interface CompileRequest {
  /** Unique catalog id, e.g. `loan-payoff`. */
  id: string;
  target: {
    vendor: string;
    product: string;
    tenant?: string;
    url?: string;
  };
  /** In-memory trace from {@link DiscoveryAgent}. */
  events?: DiscoveryTraceEvent[];
  /** Append-only JSONL on disk (one event object per line). */
  tracePath?: string;
  name?: string;
  capabilityVersion?: string;
  /**
   * Discovery-time values to replace with `{ input: name }` on fill/select.
   */
  inputValues?: Record<string, DiscoveredInput>;
  /** When set, `save` the base artifact and a header-only tenant override. */
  registry?: CapabilityRegistry;
  runId?: string;
}

/**
 * Compile a capability from a discovery trace. Only the success-path stack
 * becomes `steps`; dead-ends remain evidence.
 */
export class CapabilityCompiler {
  async compile(request: CompileRequest): Promise<CapabilityArtifact> {
    const events = await loadTraceEvents(request);
    const path = extractSuccessfulPath(events);
    if (path.length === 0) {
      throw new Error("CapabilityCompiler: trace has no successful executable path");
    }
    const inputValues = request.inputValues ?? {};
    const usedIds = new Set<string>();
    const steps: CapabilityStep[] = [];
    for (const [index, step] of path.entries()) {
      if (step.insertHandoff !== undefined && step.action.type !== "handoff") {
        const handoff = {
          type: "handoff" as const,
          reason: step.insertHandoff,
        };
        steps.push({
          id: uniqueStepId(handoff, index, usedIds),
          preconditions: [],
          action: handoff,
          postconditions: [],
        });
      }
      steps.push(toStep(step, path[index - 1], index, inputValues, usedIds));
    }
    const version = request.capabilityVersion ?? "1.0.0";
    const artifact: CapabilityArtifact = {
      schemaVersion: "1.0",
      capabilityVersion: version,
      id: request.id,
      name: request.name ?? request.id,
      target: {
        vendor: request.target.vendor,
        product: request.target.product,
      },
      ...(request.target.tenant === undefined
        ? {}
        : { discoveredOn: { tenant: request.target.tenant } }),
      inputs: inputsFromActions(
        steps.map((step) => step.action),
        inputValues,
      ),
      outputs: deriveOutputs(steps),
      steps,
      success: deriveSuccess(path),
    };
    if (request.registry !== undefined) {
      await persistDiscoveredCapability(request.registry, artifact, {
        ...(request.target.tenant === undefined ? {} : { tenant: request.target.tenant }),
        ...(request.runId === undefined ? {} : { runId: request.runId }),
      });
    }
    return artifact;
  }
}

export async function persistDiscoveredCapability(
  registry: CapabilityRegistry,
  artifact: CapabilityArtifact,
  options: { tenant?: string; runId?: string },
): Promise<void> {
  const existing = await registry.get(artifact.id, artifact.capabilityVersion);
  if (existing !== undefined) {
    throw new Error(
      `capability ${artifact.id}@${artifact.capabilityVersion} already exists; bump capabilityVersion`,
    );
  }
  await registry.save(artifact);
  if (options.tenant === undefined) {
    return;
  }
  await registry.saveOverride({
    schemaVersion: "1.0",
    id: `${artifact.id}-${options.tenant}`,
    baseCapability: `${artifact.id}@${artifact.capabilityVersion}`,
    target: { tenant: options.tenant },
    overrides: {},
    provenance: {
      createdBy: "discovery",
      reason: "enrolled discovering tenant",
      ...(options.runId === undefined ? {} : { createdFromRun: options.runId }),
    },
  });
}

export async function loadTraceEvents(
  request: Pick<CompileRequest, "events" | "tracePath">,
): Promise<DiscoveryTraceEvent[]> {
  if (request.events !== undefined) {
    return request.events;
  }
  if (request.tracePath === undefined) {
    throw new Error("CapabilityCompiler: provide events or tracePath");
  }
  const text = await readFile(request.tracePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DiscoveryTraceEvent);
}

function toStep(
  step: SuccessfulPathStep,
  previous: SuccessfulPathStep | undefined,
  index: number,
  inputValues: Record<string, DiscoveredInput>,
  usedIds: Set<string>,
): CapabilityStep {
  const action = semanticAction(parameterizeAction(step.action, inputValues));
  const { preconditions, postconditions } = deriveCheckpoints(step, previous);
  return {
    id: uniqueStepId(action, index, usedIds),
    preconditions,
    action,
    postconditions,
  };
}
