import { PassThrough, Readable } from "node:stream";

import type { EvidenceEvent, EvidenceWriter } from "@icas/evidence";
import { describe, expect, it } from "vitest";

import { promptForApproval, promptForValue } from "./cli-prompt.js";

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

describe("CLI prompts", () => {
  it("records a stubbed yes as human approval evidence", async () => {
    const { events, evidence } = memoryEvidence();
    const stdout = new PassThrough();
    const approved = await promptForApproval("Generate the official payoff statement? [y/N] ", {
      stdin: Readable.from(["y\n"]),
      stdout,
      evidence,
      runId: "run-001",
      runType: "replay",
    });
    expect(approved).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId: "run-001",
      runType: "replay",
      type: "human_input",
      actor: "human",
      payload: {
        kind: "approval",
        question: "Generate the official payoff statement? [y/N] ",
        answer: "y",
        approved: true,
      },
    });
  });

  it("records a stubbed value as human input evidence", async () => {
    const { events, evidence } = memoryEvidence();
    const stdout = new PassThrough();
    const value = await promptForValue("Selection: ", {
      stdin: Readable.from(["Refinance\n"]),
      stdout,
      evidence,
      runId: "run-002",
      runType: "discovery",
    });
    expect(value).toBe("Refinance");
    expect(events[0]).toMatchObject({
      actor: "human",
      type: "human_input",
      payload: { kind: "value", answer: "Refinance" },
    });
  });
});
