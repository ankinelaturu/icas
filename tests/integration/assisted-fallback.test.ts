import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "../../packages/browser/src/playwright-surface.js";
import type { CapabilityArtifact } from "../../packages/capability/src/artifact.js";
import { ReplayEngine } from "../../packages/replay/src/replay-engine.js";

import { fixturePolicy, pageUrl } from "./fixture-pages.js";

const brokenClick: CapabilityArtifact = {
  schemaVersion: "1.0",
  id: "open-lending",
  name: "Assist onto lending",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {},
  outputs: {},
  steps: [
    {
      id: "open-lending",
      preconditions: [{ type: "textVisible", value: "Home" }],
      action: {
        type: "click",
        target: {
          strategies: [{ type: "visibleText", text: "Does Not Exist" }],
        },
        risk: "safe",
      },
      postconditions: [{ type: "textVisible", value: "Lending Services" }],
    },
  ],
  success: [{ type: "textVisible", value: "Lending Services" }],
};

/** Fill succeeds; catalog Search is missing; page submit is Look Up. */
const renamedSubmitReplay: CapabilityArtifact = {
  schemaVersion: "1.0",
  id: "loan-payoff-lookup",
  name: "Assist renamed submit",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {
    loanAccountId: { type: "string", required: true },
  },
  outputs: {},
  steps: [
    {
      id: "fill-ln-acct",
      preconditions: [{ type: "textVisible", value: "Search Loan Account" }],
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
      id: "click-search",
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

describe("assisted fallback integration", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 4_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("repairs a missing control by clicking Lending and rejoins", async () => {
    await surface.open(pageUrl("home.html"));
    const engine = new ReplayEngine(surface, {
      policy: fixturePolicy(),
      repair: {
        propose: async () => ({
          actions: [
            {
              type: "click",
              target: {
                strategies: [{ type: "roleText", role: "button", text: "Lending" }],
              },
            },
          ],
          rationale: "use the visible Lending button",
        }),
      },
    });
    const result = await engine.run(brokenClick, {}, {
      runId: "int-assist",
      assist: true,
    });
    expect(result.status).toBe("success");
    expect(result).toMatchObject({ capabilityId: "open-lending", runId: "int-assist" });
  });

  it("repairs a renamed next submit after a successful fill and does not write a catalog", async () => {
    await surface.open(pageUrl("search-lookup.html"));
    const engine = new ReplayEngine(surface, {
      policy: fixturePolicy(),
      repair: {
        propose: async (context) => {
          expect(context.step.id).toBe("click-search");
          expect(context.pageText).toContain("Look Up");
          return {
            actions: [
              {
                type: "click",
                target: {
                  strategies: [{ type: "visibleText", text: "Look Up" }],
                },
              },
            ],
            rationale: "Search was renamed Look Up",
          };
        },
      },
    });
    const result = await engine.run(
      renamedSubmitReplay,
      { loanAccountId: "112233" },
      { runId: "int-assist-next", assist: true },
    );
    expect(result.status).toBe("success");
    expect(result).toMatchObject({
      capabilityId: "loan-payoff-lookup",
      runId: "int-assist-next",
    });
  });
});
