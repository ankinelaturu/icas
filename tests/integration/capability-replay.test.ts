import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "../../packages/browser/src/playwright-surface.js";
import type { CapabilityArtifact } from "../../packages/capability/src/artifact.js";
import { ReplayEngine } from "../../packages/replay/src/replay-engine.js";

import { fixturePolicy, pageUrl } from "./fixture-pages.js";

const payoffReplay: CapabilityArtifact = {
  schemaVersion: "1.0",
  capabilityVersion: "1.0.0",
  id: "loan-payoff",
  name: "Fixture payoff replay",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {
    loanAccountId: { type: "string", required: true },
  },
  outputs: {
    totalPayoffAmount: {
      type: "money",
      extract: {
        target: {
          strategies: [{ type: "label", label: "Total Payoff Amount" }],
        },
      },
    },
  },
  steps: [
    {
      id: "open-lending",
      preconditions: [{ type: "textVisible", value: "Home" }],
      action: {
        type: "click",
        target: {
          strategies: [{ type: "roleText", role: "button", text: "Lending" }],
        },
        risk: "safe",
      },
      postconditions: [{ type: "textVisible", value: "Lending Services" }],
    },
    {
      id: "open-loan-search",
      preconditions: [
        {
          type: "controlPresent",
          target: { strategies: [{ type: "visibleText", text: "Loan Search" }] },
        },
      ],
      action: {
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Loan Search" }] },
        risk: "safe",
      },
      postconditions: [{ type: "textVisible", value: "Search Loan Account" }],
    },
    {
      id: "enter-loan-account",
      preconditions: [
        {
          type: "controlPresent",
          target: { strategies: [{ type: "label", label: "Loan Account" }] },
        },
      ],
      action: {
        type: "fill",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { input: "loanAccountId" },
        risk: "safe",
      },
      postconditions: [
        {
          type: "valueEquals",
          target: { strategies: [{ type: "label", label: "Loan Account" }] },
          value: { input: "loanAccountId" },
        },
      ],
    },
    {
      id: "search",
      preconditions: [],
      action: {
        type: "click",
        target: {
          strategies: [{ type: "roleText", role: "button", text: "Search" }],
        },
        risk: "safe",
      },
      postconditions: [{ type: "textVisible", value: "Payoff Statement" }],
    },
  ],
  success: [{ type: "textVisible", value: "Payoff Statement" }],
};

describe("capability replay integration", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 4_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("replays the fixture lending path and extracts the payoff amount", async () => {
    await surface.open(pageUrl("home.html"));
    const engine = new ReplayEngine(surface, { policy: fixturePolicy() });
    const result = await engine.run(
      payoffReplay,
      { loanAccountId: "9876543210" },
      { runId: "int-replay" },
    );
    expect(result).toEqual({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: { totalPayoffAmount: "1234.56" },
      runId: "int-replay",
    });
  });
});
