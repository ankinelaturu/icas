/**
 * @file FileSystemEvidenceWriter — append-only JSONL plus summary.json under a temp or evidence root.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Redactor } from "@icas/redactor";

import { assertEvidenceSegment, EvidenceError } from "./evidence-error.js";
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
  /** Evidence-profile redactor. Payloads are masked before they hit disk. */
  redactor: Redactor;
}

/**
 * Layout: `<root>/<capabilityId>/<runId>/{trace|log}.jsonl`, `summary.json`, `observations/`.
 *
 * Discovery writes `trace.jsonl`. Replay and adaptation write `log.jsonl`.
 */
export class FileSystemEvidenceWriter implements EvidenceWriter {
  private readonly root: string;
  private readonly capabilityId: string;
  private readonly runId: string;
  private readonly runType: RunType;
  private readonly redactor: Redactor;
  private screenshotCount = 0;
  private domCount = 0;
  private traceCount = 0;

  constructor(options: FileSystemEvidenceWriterOptions) {
    this.root = options.root;
    this.capabilityId = assertEvidenceSegment(options.capabilityId, "capabilityId");
    this.runId = assertEvidenceSegment(options.runId, "runId");
    this.runType = options.runType;
    this.redactor = options.redactor;
  }

  /**
   * Directory that holds this run's JSONL, summary, and observations.
   */
  runDirectory(): string {
    return join(this.root, this.capabilityId, this.runId);
  }

  /**
   * Directory for screenshots and DOM captures.
   */
  observationsDirectory(): string {
    return join(this.runDirectory(), "observations");
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
    await appendFile(
      this.eventsPath(),
      `${JSON.stringify(this.redactEvent(event))}\n`,
      "utf8",
    );
  }

  async writeSummary(summary: RunSummary): Promise<void> {
    await mkdir(this.runDirectory(), { recursive: true });
    const redacted = this.redactor.redactValue(summary);
    await writeFile(
      this.summaryPath(),
      `${JSON.stringify(redacted, null, 2)}\n`,
      "utf8",
    );
  }

  /**
   * Persist a screenshot, DOM snapshot, or extra trace blob under `observations/`.
   *
   * Screenshots are binary and are not string-redacted. DOM and trace JSON go
   * through the evidence redactor before write.
   */
  async captureRichSignal(
    kind: "screenshot" | "dom" | "trace",
    value: unknown,
  ): Promise<void> {
    await mkdir(this.observationsDirectory(), { recursive: true });
    if (kind === "screenshot") {
      this.screenshotCount += 1;
      const relative = `observations/screenshot-${String(this.screenshotCount).padStart(3, "0")}.png`;
      await writeFile(join(this.runDirectory(), relative), await this.screenshotBytes(value));
      await this.append({
        timestamp: new Date().toISOString(),
        runId: this.runId,
        type: "rich_signal",
        payload: { kind, path: relative },
      });
      return;
    }
    const relative =
      kind === "dom"
        ? `observations/dom-${String(++this.domCount).padStart(3, "0")}.json`
        : `observations/trace-${String(++this.traceCount).padStart(3, "0")}.json`;
    const redacted = this.redactor.redactValue(value);
    await writeFile(
      join(this.runDirectory(), relative),
      `${JSON.stringify(redacted, null, 2)}\n`,
      "utf8",
    );
    await this.append({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      type: "rich_signal",
      payload: { kind, path: relative },
    });
  }

  private redactEvent(event: EvidenceEvent): EvidenceEvent {
    if (!("payload" in event) || event.payload === undefined) {
      return event;
    }
    return { ...event, payload: this.redactor.redactValue(event.payload) };
  }

  private async screenshotBytes(value: unknown): Promise<Uint8Array> {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (typeof value === "string") {
      return await readFile(value);
    }
    throw new EvidenceError("screenshot signal must be bytes or a file path.");
  }
}
