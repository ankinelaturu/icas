/**
 * @file Discovery trace event-order tests.
 */

import { describe, expect, it } from "vitest";

import type { EvidenceEvent, EvidenceWriter, RunSummary } from "@icas/evidence";

import { DiscoveryAgent } from "../src/discovery-agent.js";
import { DISCOVERY_TRACE_TYPES } from "../src/discovery-trace.js";
import { FakeProposer } from "./test-support/fake-proposer.js";
import { MINIMAL_SUCCESS_RESULT } from "./test-support/success-result.js";
import { FakeSurface } from "./test-support/fake-surface.js";

class CapturingEvidence implements EvidenceWriter {
  readonly types: string[] = [];
  screenshots: unknown[] = [];
  summary: RunSummary | undefined;

  async append(event: EvidenceEvent): Promise<void> {
    this.types.push(event.type);
  }

  async writeSummary(summary: RunSummary): Promise<void> {
    this.summary = summary;
  }

  async captureRichSignal(kind: "screenshot" | "dom" | "trace", value: unknown): Promise<void> {
    if (kind === "screenshot") {
      this.screenshots.push(value);
    }
  }
}

describe("DiscoveryTrace", () => {
  it("writes expected event types in order and refs the screenshot", async () => {
    const evidence = new CapturingEvidence();
    const surface = new FakeSurface();
    surface.observation = {
      id: "home",
      url: "http://localhost:4101/",
      imagePath: "/tmp/step-001.png",
    };
    surface.executeHandler = () => {
      surface.observation = {
        id: "lending",
        url: "http://localhost:4101/lending.htm",
        imagePath: "/tmp/step-002.png",
      };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      evidence,
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [
            {
              action: {
                type: "click",
                target: { strategies: [{ type: "visibleText", text: "Lending" }] },
                risk: "safe",
              },
              rationale: "Open lending",
              rank: 1,
            },
          ],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run({
      id: "loan-payoff",
      goal: "Generate a payoff statement",
      target: {
        vendor: "icas-bank",
        product: "icas-bank",
        tenant: "icas-bank",
        url: "http://localhost:4101/",
      },
    });
    expect(result.status).toBe("success");
    expect(evidence.types).toEqual([
      "observation",
      "candidates",
      "chosen_action",
      "policy",
      "action_result",
      "observation",
      "candidates",
      "success",
    ]);
    expect(evidence.screenshots).toEqual(["/tmp/step-001.png", "/tmp/step-002.png"]);
    expect(evidence.summary?.runType).toBe("discovery");
    expect(evidence.summary?.status).toBe("success");
    expect(DISCOVERY_TRACE_TYPES).toContain("backtrack");
  });
});
