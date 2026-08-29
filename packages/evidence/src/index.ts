/**
 * @file @icas/evidence — run-scoped traces, replay logs, and summaries.
 */

export type {
  EvidenceActor,
  EvidenceEvent,
  EvidenceWriter,
  RunSummary,
  RunType,
} from "./evidence-types.js";
export {
  ASSISTED_FALLBACK_EVENT,
  DETERMINISTIC_ACTION_EVENT,
} from "./evidence-types.js";
export { EvidenceError, assertEvidenceSegment } from "./evidence-error.js";
export {
  FileSystemEvidenceWriter,
  type FileSystemEvidenceWriterOptions,
} from "./filesystem-evidence-writer.js";
