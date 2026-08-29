/**
 * @file CapabilityCompiler — trace → base artifact (successful path only).
 *
 * Failed exploration stays in the JSONL evidence. Later passes add
 * checkpoints, registry writes, and human-action classification.
 */

import { readFile } from "node:fs/promises";

import type { CapabilityAction, CapabilityArtifact, CapabilityStep } from "@icas/capability";

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
  target: { vendor: string; product: string };
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
    const steps = path.map((step, index) => toStep(step, index, inputValues));
    const last = path[path.length - 1];
    const successValue = last?.expectation ?? "completed";
    return {
      schemaVersion: "1.0",
      capabilityVersion: request.capabilityVersion ?? "1.0.0",
      id: request.id,
      name: request.name ?? request.id,
      target: {
        vendor: request.target.vendor,
        product: request.target.product,
      },
      inputs: inputsFromActions(
        steps.map((step) => step.action),
        inputValues,
      ),
      outputs: {},
      steps,
      success: [{ type: "textVisible", value: successValue }],
    };
  }
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
  index: number,
  inputValues: Record<string, DiscoveredInput>,
): CapabilityStep {
  return {
    id: stepId(step.action, index),
    preconditions: [],
    action: parameterizeAction(step.action, inputValues),
    postconditions: [],
  };
}

function stepId(action: CapabilityAction, index: number): string {
  return `${action.type}-${String(index + 1)}`;
}
