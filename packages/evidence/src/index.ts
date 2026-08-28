export type RunType = "discovery" | "replay" | "adaptation";

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

export interface EvidenceEvent {
  timestamp: string;
  runId: string;
  type: string;
  actor?: "agent" | "replay" | "human";
  payload?: unknown;
}

export interface EvidenceWriter {
  append(event: EvidenceEvent): Promise<void>;
  writeSummary(summary: RunSummary): Promise<void>;
  captureRichSignal?(kind: "screenshot" | "dom" | "trace", value: unknown): Promise<void>;
}
