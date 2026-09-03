import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "../../packages/browser/src/playwright-surface.js";
import type { CapabilityArtifact } from "../../packages/capability/src/artifact.js";
import { ReplayEngine } from "../../packages/replay/src/replay-engine.js";

import { fixturePolicy, pageUrl } from "./fixture-pages.js";

const missingLoan: CapabilityArtifact = {
  schemaVersion: "1.0",
  id: "loan-payoff",
  name: "Missing loan",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {},
  outputs: {},
  steps: [
    {
      id: "acknowledge",
      preconditions: [{ type: "textVisible", value: "Loan Search Results" }],
      action: {
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Back" }] },
        risk: "safe",
      },
      postconditions: [],
      possibleOutcomes: [
        {
          kind: "error",
          match: { phrases: ["Loan not found"] },
          heading: "Loan not found",
          summary: "No loan matches the requested account id.",
        },
      ],
    },
    {
      id: "open-payoff",
      preconditions: [],
      action: {
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Payoff" }] },
        risk: "safe",
      },
      postconditions: [],
    },
  ],
  success: [{ type: "textVisible", value: "Payoff Statement" }],
};

describe("loan not found integration", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 4_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("returns business_outcome from possibleOutcomes when the next locator is missing", async () => {
    await surface.open(pageUrl("loan-not-found.html"));
    const engine = new ReplayEngine(surface, { policy: fixturePolicy() });
    const result = await engine.run(missingLoan, {}, { runId: "int-missing" });
    expect(result).toEqual({
      status: "business_outcome",
      capabilityId: "loan-payoff",
      outcome: "loan_not_found",
      details: {
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
        message: "Loan not found",
        match: { phrases: ["Loan not found"] },
      },
      runId: "int-missing",
    });
  });
});
