/**
 * @file Discovery request/result types shared by the agent and compiler.
 */

import type { CapabilityArtifact } from "@icas/capability";

export interface DiscoveryTarget {
  vendor: string;
  product: string;
  tenant: string;
  url: string;
}

export interface DiscoveryRequest {
  /** Unique catalog id, e.g. `loan-payoff`. */
  id: string;
  target: DiscoveryTarget;
  goal: string;
  maxSteps?: number;
  maxDepth?: number;
  maxCandidatesPerState?: number;
  timeoutMs?: number;
}

export interface DiscoveryTraceEvent {
  type: string;
  payload?: unknown;
}

export interface DiscoveryResult {
  status: "success" | "stuck" | "failed";
  capability?: CapabilityArtifact;
  runId: string;
  reason?: string;
  /** In-memory record of this run; JSONL persistence is a later pass. */
  events: DiscoveryTraceEvent[];
}
