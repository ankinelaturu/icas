/**
 * @file FileSystemEvidenceWriter — append-only JSONL plus summary.json under a temp or evidence root.
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertEvidenceSegment } from "./evidence-error.js";
import type {
  EvidenceEvent,
  EvidenceWriter,
  RunSummary,
  RunType,
} from "./evidence-types.js";

/**
 * Options for a filesystem evidence writer.
 */
export interface FileSystemEvidenceWriterOptions {
  /** Evidence root. Production is repo `evidence/`; tests pass a temp directory. */
  root: string;
  capabilityId: string;
  runId: string;
  runType: RunType;
}

/**
 * Layout: `<root>/<capabilityId>/<runId>/{trace|log}.jsonl` and `summary.json`.
 *
 * Discovery writes `trace.jsonl`. Replay and adaptation write `log.jsonl`.
 */
export class FileSystemEvidenceWriter implements EvidenceWriter {
  private readonly root: string;
  private readonly capabilityId: string;
  private readonly runId: string;
  private readonly runType: RunType;

  constructor(options: FileSystemEvidenceWriterOptions) {
    this.root = options.root;
    this.capabilityId = assertEvidenceSegment(options.capabilityId, "capabilityId");
    this.runId = assertEvidenceSegment(options.runId, "runId");
    this.runType = options.runType;
  }

  /**
   * Directory that holds this run's JSONL, summary, and later observations.
   */
  runDirectory(): string {
    return join(this.root, this.capabilityId, this.runId);
  }

  /**
   * Append-only events file for this run type.
   */
  eventsPath(): string {
    const name = this.runType === "discovery" ? "trace.jsonl" : "log.jsonl";
    return join(this.runDirectory(), name);
  }

  /**
   * Path to `summary.json`.
   */
  summaryPath(): string {
    return join(this.runDirectory(), "summary.json");
  }

  async append(event: EvidenceEvent): Promise<void> {
    await mkdir(this.runDirectory(), { recursive: true });
    await appendFile(this.eventsPath(), `${JSON.stringify(event)}\n`, "utf8");
  }

  async writeSummary(summary: RunSummary): Promise<void> {
    await mkdir(this.runDirectory(), { recursive: true });
    await writeFile(
      this.summaryPath(),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
  }
}
