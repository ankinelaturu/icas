/**
 * @file Evidence types — run-scoped traces, logs, and summaries.
 */

/**
 * Kind of ICAS run that produced this evidence directory.
 */
export type RunType = "discovery" | "replay" | "adaptation";

/**
 * Compact whole-run record written as `summary.json`.
 */
export interface RunSummary {
  runId: string;
  runType: RunType;
  capabilityId?: string;
  status: "success" | "business_outcome" | "failure" | "stuck";
  startedAt: string;
  finishedAt?: string;
  steps?: number;
  backtracks?: number;
}

/**
 * One append-only JSONL event.
 */
export interface EvidenceEvent {
  timestamp: string;
  runId: string;
  type: string;
  actor?: "agent" | "replay" | "human";
  payload?: unknown;
}

/**
 * Persist run-scoped evidence. Implementations redact before disk in a later pass.
 */
export interface EvidenceWriter {
  append(event: EvidenceEvent): Promise<void>;
  writeSummary(summary: RunSummary): Promise<void>;
  captureRichSignal?(kind: "screenshot" | "dom" | "trace", value: unknown): Promise<void>;
}
