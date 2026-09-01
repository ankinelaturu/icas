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

describe("assisted fallback integration", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 2_000 });

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
});
