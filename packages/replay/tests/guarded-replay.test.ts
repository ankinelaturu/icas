/**
 * @file Guarded replay stops at the first checkpoint mismatch.
 */

import { describe, expect, it } from "vitest";

import { classifyGuardedReplay } from "../src/guarded-replay.js";

describe("classifyGuardedReplay", () => {
  it("marks a successful run as compatible", () => {
    const report = classifyGuardedReplay({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: {},
      runId: "run-1",
    });
    expect(report.status).toBe("compatible");
  });

  it("surfaces the failed step on mismatch", () => {
    const report = classifyGuardedReplay({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "TARGET_NOT_FOUND",
      stepId: "open-lending",
      expected: { type: "textVisible", value: "Lending" },
      observed: false,
      runId: "run-2",
    });
    expect(report).toMatchObject({
      status: "mismatch",
      stepId: "open-lending",
    });
  });
});
