import { describe, expect, it } from "vitest";

import { ReplayEngine } from "./replay-engine.js";
import { FakeSurface } from "./test-support/fake-surface.js";
import { testCapability } from "./test-support/test-capability.js";

describe("ReplayEngine skeleton", () => {
  it("returns success for an empty-steps capability without touching the surface", async () => {
    const surface = new FakeSurface();
    const engine = new ReplayEngine(surface);
    const result = await engine.run(testCapability({ steps: [] }), {}, {
      runId: "run-empty",
    });
    expect(result).toEqual({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: {},
      runId: "run-empty",
    });
    expect(surface.executed).toEqual([]);
    expect(surface.asserted).toEqual([]);
  });

  it("returns a structured failure when the capability is missing", async () => {
    const engine = new ReplayEngine(new FakeSurface());
    const result = await engine.run(undefined, {}, { runId: "run-missing" });
    expect(result).toEqual({
      status: "failure",
      capabilityId: "unknown",
      code: "MISSING_CAPABILITY",
      runId: "run-missing",
    });
  });
});
