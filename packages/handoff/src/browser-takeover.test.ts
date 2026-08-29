import { PassThrough, Readable } from "node:stream";

import type { EvidenceEvent, EvidenceWriter } from "@icas/evidence";
import { describe, expect, it } from "vitest";

import { takeOverBrowser, type TakeoverSurface } from "./browser-takeover.js";
import { SessionHandoffController } from "./session-handoff-controller.js";

function memoryEvidence(): {
  events: EvidenceEvent[];
  evidence: EvidenceWriter;
} {
  const events: EvidenceEvent[] = [];
  return {
    events,
    evidence: {
      append: async (event) => {
        events.push(event);
      },
      writeSummary: async () => {},
      captureRichSignal: async () => {},
    },
  };
}

describe("takeOverBrowser", () => {
  it("pauses the stubbed session, records before/after observations, and restores automation", async () => {
    const { events, evidence } = memoryEvidence();
    const handoff = new SessionHandoffController();
    const order: string[] = [];
    let observeCount = 0;
    const surface: TakeoverSurface = {
      observe: async () => {
        observeCount += 1;
        order.push(`observe-${observeCount}`);
        return { id: observeCount === 1 ? "before" : "after" };
      },
      handoffToHuman: async () => {
        expect(handoff.owner()).toBe("human");
        order.push("handoffToHuman");
      },
      resumeFromHuman: async () => {
        expect(handoff.owner()).toBe("automation");
        order.push("resumeFromHuman");
      },
    };

    await takeOverBrowser({
      surface,
      handoff,
      evidence,
      stdin: Readable.from(["\n"]),
      stdout: new PassThrough(),
      runType: "replay",
      intervention: {
        runId: "run-001",
        reason: "unexpected_state",
        message: "unexpected manual-review screen",
      },
    });

    expect(handoff.owner()).toBe("automation");
    expect(order).toEqual([
      "observe-1",
      "handoffToHuman",
      "resumeFromHuman",
      "observe-2",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "handoff_start",
      "observation",
      "resume_signal",
      "observation",
      "handoff_end",
    ]);
    expect(events.every((event) => event.actor === "human")).toBe(true);
    expect(events[1]).toMatchObject({
      payload: { phase: "before", observation: { id: "before" } },
    });
    expect(events[3]).toMatchObject({
      payload: { phase: "after", observation: { id: "after" } },
    });
  });
});
