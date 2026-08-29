/**
 * @file Header-only vs one-step icas-adapt override construction.
 */

import { describe, expect, it } from "vitest";

import { buildAdaptOverride } from "../src/build-override.js";
import type { CapabilityArtifact } from "@icas/capability";

const base = {
  schemaVersion: "1.0",
  capabilityVersion: "1.0.0",
  id: "loan-payoff",
  name: "Generate Loan Payoff Statement",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {},
  outputs: {},
  steps: [
    {
      id: "open-lending",
      preconditions: [],
      action: {
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Lending" }] },
      },
      postconditions: [{ type: "textVisible", value: "Lending Services" }],
    },
  ],
  success: [{ type: "textVisible", value: "Payoff Statement" }],
} as CapabilityArtifact;

describe("buildAdaptOverride", () => {
  it("uses createdBy verified for a compatible run", async () => {
    const override = await buildAdaptOverride({
      base,
      tenant: "loki-bank",
      report: {
        status: "compatible",
        result: {
          status: "success",
          capabilityId: "loan-payoff",
          outputs: {},
          runId: "run-ok",
        },
      },
    });
    expect(override.overrides).toEqual({});
    expect(override.provenance.createdBy).toBe("verified");
    expect(override.baseCapability).toBe("loan-payoff@1.0.0");
  });

  it("patches only the divergent step with createdBy icas-adapt", async () => {
    const override = await buildAdaptOverride({
      base,
      tenant: "loki-bank",
      report: {
        status: "mismatch",
        stepId: "open-lending",
        expected: "Lending",
        observed: false,
        result: {
          status: "failure",
          capabilityId: "loan-payoff",
          code: "TARGET_NOT_FOUND",
          stepId: "open-lending",
          runId: "run-miss",
        },
      },
      specializer: {
        async specialize() {
          return {
            target: { strategies: [{ type: "visibleText", text: "Member Lending" }] },
          };
        },
      },
    });
    expect(override.provenance.createdBy).toBe("icas-adapt");
    expect(Object.keys(override.overrides.steps ?? {})).toEqual(["open-lending"]);
  });
});
