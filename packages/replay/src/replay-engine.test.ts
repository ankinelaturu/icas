import { PolicyGuard } from "@icas/policy";
import { describe, expect, it } from "vitest";

import { ReplayEngine } from "./replay-engine.js";
import { FakeSurface } from "./test-support/fake-surface.js";
import { clickStep, testCapability } from "./test-support/test-capability.js";

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

describe("ReplayEngine preconditions", () => {
  it("passes through when the first step's preconditions hold", async () => {
    const surface = new FakeSurface();
    const engine = new ReplayEngine(surface);
    const pre = { type: "textVisible" as const, value: "Home" };
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", { preconditions: [pre] }),
          clickStep("open-search"),
        ],
      }),
      {},
      { runId: "run-pre-ok" },
    );
    expect(result.status).toBe("success");
    expect(surface.asserted).toEqual([pre]);
    expect(surface.executed).toHaveLength(2);
  });

  it("fails PRECONDITION_FAILED on the first mismatched step and skips later steps", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
    const engine = new ReplayEngine(surface);
    const expected = { type: "textVisible" as const, value: "Home" };
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", { preconditions: [expected] }),
          clickStep("open-search", {
            preconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
        ],
      }),
      {},
      { runId: "run-pre-fail" },
    );
    expect(result).toEqual({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "PRECONDITION_FAILED",
      stepId: "open-lending",
      expected,
      observed: false,
      runId: "run-pre-fail",
    });
    expect(surface.asserted).toEqual([expected]);
    expect(surface.executed).toEqual([]);
  });
});

describe("ReplayEngine policy gate", () => {
  it("executes an allowed click and never executes a denied navigate", async () => {
    const surface = new FakeSurface();
    const policy = new PolicyGuard({
      allowedOrigins: ["https://bank.example"],
      allowedActionTypes: ["click", "fill"],
    });
    const engine = new ReplayEngine(surface, { policy });
    const allowed = await engine.run(
      testCapability({ steps: [clickStep("open-lending")] }),
      {},
      { runId: "run-policy-allow" },
    );
    expect(allowed.status).toBe("success");
    expect(surface.executed).toHaveLength(1);
    expect(surface.executed[0]?.type).toBe("click");

    surface.executed.length = 0;
    const denied = await engine.run(
      testCapability({
        steps: [
          {
            id: "go-admin",
            preconditions: [],
            action: { type: "navigate", path: "/admin" },
            postconditions: [],
          },
        ],
      }),
      {},
      { runId: "run-policy-deny" },
    );
    expect(denied).toMatchObject({
      status: "failure",
      code: "POLICY_BLOCKED",
      stepId: "go-admin",
      runId: "run-policy-deny",
    });
    expect(surface.executed).toEqual([]);
  });
});

