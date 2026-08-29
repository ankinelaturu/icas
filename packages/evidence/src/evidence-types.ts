/**
 * @file Evidence types — run-scoped traces, logs, and summaries.
 *
 * A capability is reusable knowledge. Each discovery, replay, or adaptation
 * execution is a separate run with its own evidence directory. Text and JSON
 * must be redacted before persist; this package does not own the patterns.
 *
 * @see FileSystemEvidenceWriter
 * @see docs/09-evidence-observability.md
 */

/**
 * Kind of ICAS run that produced this evidence directory.
 *
 * Splits LLM search (`discovery`) from model-free replay and tenant adapt so
 * traces are not mixed in one JSONL file.
 */
export type RunType = "discovery" | "replay" | "adaptation";

/**
 * Compact whole-run record written as `summary.json`.
 *
 * Reviewers should see outcome without scanning every JSONL line. Status
 * `business_outcome` is a completed run that did not take the success path.
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
 * Who produced an evidence event.
 *
 * `"human"` marks HITL (CLI answer or headed-session takeover) so those
 * events are never read as agent or replay actions.
 */
export type EvidenceActor = "agent" | "replay" | "human";

/**
 * Event `type` for a compiled-capability action during replay.
 *
 * Kept as a constant so assisted fallback cannot reuse the same type string.
 */
export const DETERMINISTIC_ACTION_EVENT = "action";

/**
 * Event `type` for a bounded LLM repair during replay. Not a deterministic action.
 *
 * Strict replay is model-free; this type makes the one `--assist` step visible.
 */
export const ASSISTED_FALLBACK_EVENT = "assisted_fallback";

/**
 * One append-only JSONL event.
 *
 * `type` is an open string so discovery can record ranking, backtrack, and
 * policy decisions without a closed enum. Envelope fields are not PII;
 * `payload` is the leak surface the writer redacts.
 */
export interface EvidenceEvent {
  timestamp: string;
  runId: string;
  runType: RunType;
  type: string;
  actor?: EvidenceActor;
  payload?: unknown;
}

/**
 * Persist run-scoped evidence. Text and JSON are redacted before disk.
 *
 * Implementations must not skip the redactor on `append` or `writeSummary`.
 * Screenshots may be stored as binary; their paths still go through `append`.
 */
export interface EvidenceWriter {
  append(event: EvidenceEvent): Promise<void>;
  writeSummary(summary: RunSummary): Promise<void>;
  captureRichSignal(kind: "screenshot" | "dom" | "trace", value: unknown): Promise<void>;
}
