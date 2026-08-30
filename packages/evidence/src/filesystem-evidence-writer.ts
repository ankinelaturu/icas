/**
 * @file FileSystemEvidenceWriter — append-only JSONL plus summary.json under a run root.
 *
 * Evidence is run-scoped; a capability is persistent knowledge. Every persistable
 * payload goes through the evidence-profile Redactor before disk. Do not
 * duplicate redaction rules here.
 *
 * @see EvidenceWriter
 * @see docs/09-evidence-observability.md
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
 * Discovery writes `trace.jsonl`. Replay and adaptation write `log.jsonl` so a
 * model-free run is not mistaken for an LLM search transcript.
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
    // Sanitize before any write so `../` cannot escape the evidence root.
    this.capabilityId = assertEvidenceSegment(options.capabilityId, "capabilityId");
    this.runId = assertEvidenceSegment(options.runId, "runId");
    this.runType = options.runType;
    this.redactor = options.redactor;
  }

  /**
   * Directory that holds this run's JSONL, summary, and observations.
   *
   * @returns `<root>/<capabilityId>/<runId>`
   */
  runDirectory(): string {
    return join(this.root, this.capabilityId, this.runId);
  }

  /**
   * Directory for screenshots and DOM captures.
   *
   * Rich signals stay next to the JSONL so a failure review does not hunt
   * another tree.
   *
   * @returns `<runDirectory>/observations`
   */
  observationsDirectory(): string {
    return join(this.runDirectory(), "observations");
  }

  /**
   * Append-only events file for this run type.
   *
   * JSONL avoids holding the whole trace in memory until the run ends.
   *
   * @returns Path to `trace.jsonl` (discovery) or `log.jsonl` (replay/adaptation)
   */
  eventsPath(): string {
    const name = this.runType === "discovery" ? "trace.jsonl" : "log.jsonl";
    return join(this.runDirectory(), name);
  }

  /**
   * Path to `summary.json`.
   *
   * @returns Compact whole-run record beside the JSONL
   */
  summaryPath(): string {
    return join(this.runDirectory(), "summary.json");
  }

  /**
   * Append one event. Stamp run identity, then redact the payload, then write.
   *
   * Stamp first so catalog ids are not treated as PII. Redact before persist
   * so a crash after stringify cannot leave raw strings on disk.
   *
   * @param event - Caller-supplied event; `runId` / `runType` are overwritten
   */
  async append(event: EvidenceEvent): Promise<void> {
    await mkdir(this.runDirectory(), { recursive: true });
    await appendFile(
      this.eventsPath(),
      `${JSON.stringify(this.redactEvent(this.stamp(event)))}\n`,
      "utf8",
    );
  }

  /**
   * Write the compact whole-run object, redacted, as pretty JSON.
   *
   * Overwrites the previous summary so the file always reflects the latest
   * finish status rather than appending a second document. `runId` / `runType`
   * are taken from this writer so callers cannot mix runs.
   *
   * @param summary - Run totals and terminal status
   */
  async writeSummary(summary: RunSummary): Promise<void> {
    await mkdir(this.runDirectory(), { recursive: true });
    // Stamp like append so an adaptation writer cannot keep a "replay" summary.
    const stamped = { ...summary, runId: this.runId, runType: this.runType };
    const redacted = this.redactor.redactValue(stamped);
    await writeFile(
      this.summaryPath(),
      `${JSON.stringify(redacted, null, 2)}\n`,
      "utf8",
    );
  }

  /**
   * Persist a screenshot, DOM snapshot, or extra trace blob under `observations/`.
   *
   * Screenshots are binary and are not string-redacted — UTF-8 masking would
   * corrupt the PNG. DOM and trace JSON go through the evidence redactor
   * before write. The JSONL records the relative path, not the pixels.
   *
   * @param kind - Screenshot bytes/path, or structured DOM/trace
   * @param value - PNG bytes or file path, or JSON-like DOM/trace
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
        runType: this.runType,
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
      runType: this.runType,
      type: "rich_signal",
      payload: { kind, path: relative },
    });
  }

  /**
   * Force this writer's run identity onto the event so a caller cannot mix runs.
   */
  private stamp(event: EvidenceEvent): EvidenceEvent {
    return { ...event, runId: this.runId, runType: this.runType };
  }

  /**
   * Mask `payload` only. Envelope fields stay so reviewers can join events.
   */
  private redactEvent(event: EvidenceEvent): EvidenceEvent {
    if (!("payload" in event) || event.payload === undefined) {
      return event;
    }
    return { ...event, payload: this.redactor.redactValue(event.payload) };
  }

  /**
   * Accept in-memory bytes or a path Playwright already wrote.
   *
   * @throws {EvidenceError} When `value` is neither bytes nor a file path
   */
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
