/**
 * @file Discovery trace — append-only JSONL plus screenshot refs via EvidenceWriter.
 */

import type { EvidenceWriter, RunSummary } from "@icas/evidence";

import type { DiscoveryTraceEvent } from "./discovery-types.js";

export const DISCOVERY_TRACE_TYPES = [
  "observation",
  "candidates",
  "chosen_action",
  "policy",
  "action_result",
  "dead_end",
  "backtrack",
  "intervention",
  "success",
] as const;

export interface DiscoveryTraceOptions {
  runId: string;
  capabilityId: string;
  evidence?: EvidenceWriter;
}

/**
 * In-memory events always; disk JSONL when an {@link EvidenceWriter} is supplied.
 */
export class DiscoveryTrace {
  readonly events: DiscoveryTraceEvent[] = [];
  private readonly runId: string;
  private readonly capabilityId: string;
  private readonly evidence: EvidenceWriter | undefined;
  private steps = 0;
  private backtracks = 0;

  constructor(options: DiscoveryTraceOptions) {
    this.runId = options.runId;
    this.capabilityId = options.capabilityId;
    this.evidence = options.evidence;
  }

  /**
   * Append one event. Observations with `imagePath` also capture a screenshot ref.
   */
  async record(event: DiscoveryTraceEvent): Promise<void> {
    this.events.push(event);
    if (event.type === "action_result") {
      this.steps += 1;
    }
    if (event.type === "backtrack") {
      this.backtracks += 1;
    }
    if (this.evidence !== undefined) {
      await this.evidence.append({
        timestamp: new Date().toISOString(),
        runId: this.runId,
        runType: "discovery",
        type: event.type,
        actor: "agent",
        payload: event.payload,
      });
      const imagePath = screenshotPath(event);
      if (imagePath !== undefined) {
        await this.evidence.captureRichSignal("screenshot", imagePath);
      }
    }
  }

  async finish(status: RunSummary["status"]): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    await this.evidence.writeSummary({
      runId: this.runId,
      runType: "discovery",
      capabilityId: this.capabilityId,
      status,
      startedAt: new Date().toISOString(),
      steps: this.steps,
      backtracks: this.backtracks,
    });
  }
}

function screenshotPath(event: DiscoveryTraceEvent): string | undefined {
  if (event.type !== "observation" || event.payload === undefined) {
    return undefined;
  }
  if (typeof event.payload !== "object" || event.payload === null) {
    return undefined;
  }
  if (!("imagePath" in event.payload)) {
    return undefined;
  }
  const path = (event.payload as { imagePath?: unknown }).imagePath;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}
