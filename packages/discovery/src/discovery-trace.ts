/**
 * @file Discovery trace — append-only JSONL plus screenshot refs via EvidenceWriter.
 *
 * In-memory `events` always accumulate so the compiler can run without disk.
 * Disk writes happen only when an {@link EvidenceWriter} is injected.
 */

import type { EvidenceWriter, RunSummary } from "@icas/evidence";

import type { DiscoveryTraceEvent } from "./discovery-types.js";

/**
 * Event type strings the agent records. The compiler stack only reacts to
 * `chosen_action` + ok `action_result` (push) and `backtrack` (pop).
 */
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
  /** Omit in unit tests that only need in-memory `events`. */
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
  /** Counted from `action_result` / `backtrack` for the run summary. */
  private steps = 0;
  private backtracks = 0;

  constructor(options: DiscoveryTraceOptions) {
    this.runId = options.runId;
    this.capabilityId = options.capabilityId;
    this.evidence = options.evidence;
  }

  /**
   * Append one event. Observations with `imagePath` also capture a screenshot ref.
   *
   * Counters only move on `action_result` and `backtrack` so the summary matches
   * executed work and DFS retreats, not every observation.
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

  /**
   * Write the run summary. No-op when evidence is unwired so tests stay disk-free.
   *
   * @param status - Final search outcome recorded on the summary
   */
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

/**
 * Screenshot refs live on observation payloads only. Other event types must
 * not pull a stale imagePath from a nested object.
 */
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
