import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvidenceError } from "./evidence-error.js";
import { FileSystemEvidenceWriter } from "./filesystem-evidence-writer.js";
import type { EvidenceEvent, RunSummary } from "./evidence-types.js";

describe("FileSystemEvidenceWriter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-evidence-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("appends two events and writes summary.json under a temp run directory", async () => {
    const writer = new FileSystemEvidenceWriter({
      root,
      capabilityId: "loan-payoff",
      runId: "run-001",
      runType: "discovery",
    });
    const first: EvidenceEvent = {
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-001",
      type: "observation",
      payload: { page: "home" },
    };
    const second: EvidenceEvent = {
      timestamp: "2026-08-28T00:00:01.000Z",
      runId: "run-001",
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

  it("writes replay events to log.jsonl, not trace.jsonl", async () => {
    const writer = new FileSystemEvidenceWriter({
      root,
      capabilityId: "loan-payoff",
      runId: "run-002",
      runType: "replay",
    });
    await writer.append({
      timestamp: "2026-08-28T00:00:00.000Z",
      runId: "run-002",
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
        }),
    ).toThrow(EvidenceError);
  });
});
