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
    expect(surface.asserted).toEqual([
      { type: "textVisible", value: "Payoff Statement" },
    ]);
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
    expect(surface.asserted).toEqual([
      pre,
      { type: "textVisible", value: "Payoff Statement" },
    ]);
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

describe("ReplayEngine execute and postconditions", () => {
  it("succeeds when the action runs and postconditions hold", async () => {
    const surface = new FakeSurface();
    const post = { type: "textVisible" as const, value: "Lending Services" };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending", { postconditions: [post] })],
      }),
      {},
      { runId: "run-post-ok" },
    );
    expect(result.status).toBe("success");
    expect(surface.executed).toHaveLength(1);
    expect(surface.asserted).toEqual([
      post,
      { type: "textVisible", value: "Payoff Statement" },
    ]);
  });

  it("fails POSTCONDITION_FAILED when the page does not match after execute", async () => {
    const surface = new FakeSurface();
    const post = { type: "textVisible" as const, value: "Lending Services" };
    surface.assertHandler = (assertion) =>
      !(assertion.type === "textVisible" && assertion.value === "Lending Services");
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending", { postconditions: [post] })],
      }),
      {},
      { runId: "run-post-fail" },
    );
    expect(result).toEqual({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "POSTCONDITION_FAILED",
      stepId: "open-lending",
      expected: post,
      observed: false,
      runId: "run-post-fail",
    });
    expect(surface.executed).toHaveLength(1);
  });

  it("fails TARGET_NOT_FOUND when execute cannot locate the control", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = () => {
      const error = new Error("no matching control");
      (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
      throw error;
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({ steps: [clickStep("open-lending")] }),
      {},
      { runId: "run-target" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "TARGET_NOT_FOUND",
      stepId: "open-lending",
      runId: "run-target",
    });
  });
});

describe("ReplayEngine success and outputs", () => {
  it("extracts typed money outputs after overall success assertions pass", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = (action) => {
      if (action.type === "read") {
        return { status: "ok", details: { value: "1234.56" } };
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending")],
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
      }),
      {},
      { runId: "run-outputs" },
    );
    expect(result).toEqual({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: { totalPayoffAmount: "1234.56" },
      runId: "run-outputs",
    });
  });

  it("fails OUTPUT_EXTRACTION_FAILED when a declared output cannot be read", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = (action) => {
      if (action.type === "read") {
        return { status: "ok", details: {} };
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending")],
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
      }),
      {},
      { runId: "run-extract-fail" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "OUTPUT_EXTRACTION_FAILED",
      runId: "run-extract-fail",
    });
  });
});

