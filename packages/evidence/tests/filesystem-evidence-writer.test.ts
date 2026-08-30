import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRedactor } from "@icas/redactor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvidenceError } from "../src/evidence-error.js";
import { FileSystemEvidenceWriter } from "../src/filesystem-evidence-writer.js";
import {
  ASSISTED_FALLBACK_EVENT,
  DETERMINISTIC_ACTION_EVENT,
} from "../src/evidence-types.js";
import type { EvidenceEvent, RunSummary } from "../src/evidence-types.js";

function createWriter(
  root: string,
  runType: "discovery" | "replay" | "adaptation" = "discovery",
  runId = "run-001",
): FileSystemEvidenceWriter {
  return new FileSystemEvidenceWriter({
    root,
    capabilityId: "loan-payoff",
    runId,
    runType,
    redactor: createRedactor("evidence"),
  });
}

describe("FileSystemEvidenceWriter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-evidence-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("appends two events and writes summary.json under a temp run directory", async () => {
    const writer = createWriter(root);
    const first: EvidenceEvent = {
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      runType: "discovery",
      type: "observation",
      payload: { page: "home" },
    };
    const second: EvidenceEvent = {
      timestamp: "2026-08-28T00:00:01.000Z",
      runId: "run-001",
      runType: "discovery",
      type: "action_result",
      payload: { status: "success" },
    };
    await writer.append(first);
    await writer.append(second);
    const summary: RunSummary = {
      runId: "run-001",
      runType: "discovery",
      capabilityId: "loan-payoff",
      status: "success",
      startedAt: "2026-08-28T00:00:00.000Z",
      steps: 1,
    };
    await writer.writeSummary(summary);

    const raw = await readFile(writer.eventsPath(), "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual(first);
    expect(JSON.parse(lines[1] ?? "")).toEqual(second);
    expect(writer.eventsPath()).toBe(
      join(root, "loan-payoff", "run-001", "trace.jsonl"),
    );
    expect(JSON.parse(await readFile(writer.summaryPath(), "utf8"))).toEqual(
      summary,
    );
  });

  it("stamps summary runId and runType from the writer, not the caller", async () => {
    const writer = createWriter(root, "adaptation", "run-adapt");
    await writer.writeSummary({
      runId: "wrong-id",
      runType: "replay",
      status: "success",
      startedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(JSON.parse(await readFile(writer.summaryPath(), "utf8"))).toMatchObject({
      runId: "run-adapt",
      runType: "adaptation",
      status: "success",
    });
  });

  it("writes replay events to log.jsonl, not trace.jsonl", async () => {
    const writer = createWriter(root, "replay", "run-002");
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-002",
      runType: "replay",
      type: "action",
      actor: "replay",
    });
    expect(writer.eventsPath()).toBe(
      join(root, "loan-payoff", "run-002", "log.jsonl"),
    );
  });

  it("rejects path separators in capabilityId and runId", () => {
    expect(
      () =>
        new FileSystemEvidenceWriter({
          root,
          capabilityId: "../escape",
          runId: "run-001",
          runType: "replay",
          redactor: createRedactor("evidence"),
        }),
    ).toThrow(EvidenceError);
  });

  it("redacts payloads before they are written to disk", async () => {
    const writer = createWriter(root);
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      runType: "discovery",
      type: "observation",
      payload: { note: "SSN 123-45-6789" },
    });
    const line = (await readFile(writer.eventsPath(), "utf8")).trimEnd();
    expect(JSON.parse(line)).toMatchObject({
      payload: { note: "SSN [REDACTED_SSN]" },
    });
  });

  it("writes a screenshot under observations/ and records its path", async () => {
    const writer = createWriter(root);
    const png = Buffer.from("fake-png-bytes");
    await writer.captureRichSignal("screenshot", png);
    const relative = "observations/screenshot-001.png";
    expect(await readFile(join(writer.runDirectory(), relative))).toEqual(png);
    const event = JSON.parse(
      (await readFile(writer.eventsPath(), "utf8")).trimEnd(),
    ) as EvidenceEvent;
    expect(event).toMatchObject({
      type: "rich_signal",
      payload: { kind: "screenshot", path: relative },
    });
  });

  it("redacts DOM captures before writing observations JSON", async () => {
    const writer = createWriter(root);
    await writer.captureRichSignal("dom", {
      html: "contact teller@bank.example",
    });
    const relative = "observations/dom-001.json";
    expect(
      JSON.parse(await readFile(join(writer.runDirectory(), relative), "utf8")),
    ).toEqual({ html: "contact [REDACTED_EMAIL]" });
  });

  it("tags discovery events with runType discovery and actor agent", async () => {
    const writer = createWriter(root, "discovery");
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      runType: "replay",
      type: "observation",
      actor: "agent",
    });
    expect(JSON.parse((await readFile(writer.eventsPath(), "utf8")).trimEnd())).toMatchObject({
      runType: "discovery",
      actor: "agent",
    });
  });

  it("distinguishes assisted-fallback events from deterministic replay actions", async () => {
    const writer = createWriter(root, "replay");
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      runType: "replay",
      type: DETERMINISTIC_ACTION_EVENT,
      actor: "replay",
    });
    await writer.append({
      timestamp: "2026-08-28T00:00:01.000Z",
      runId: "run-001",
      runType: "replay",
      type: ASSISTED_FALLBACK_EVENT,
      actor: "agent",
    });
    const lines = (await readFile(writer.eventsPath(), "utf8")).trimEnd().split("\n");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      runType: "replay",
      type: "action",
      actor: "replay",
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({
      runType: "replay",
      type: "assisted_fallback",
      actor: "agent",
    });
    expect(DETERMINISTIC_ACTION_EVENT).not.toBe(ASSISTED_FALLBACK_EVENT);
  });

  it("tags adaptation runs separately from discovery and replay", async () => {
    const writer = createWriter(root, "adaptation");
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      runType: "adaptation",
      type: "override_saved",
      actor: "agent",
    });
    expect(JSON.parse((await readFile(writer.eventsPath(), "utf8")).trimEnd())).toMatchObject({
      runType: "adaptation",
    });
    expect(writer.eventsPath()).toMatch(/log\.jsonl$/);
  });
});
