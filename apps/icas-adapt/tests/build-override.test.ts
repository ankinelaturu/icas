/**
 * @file Header-only vs one-step icas-adapt override construction.
 */

import { describe, expect, it } from "vitest";

import type { CapabilityArtifact, CapabilityOverride } from "@icas/capability";

import { assertBoundedAdaptPatch, buildAdaptOverride } from "../src/build-override.js";

const base = {
  schemaVersion: "1.0",
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
    expect(override.baseCapability).toBe("loan-payoff");
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

  it("aborts when the mismatch has no step id (whole-flow failure)", async () => {
    await expect(
      buildAdaptOverride({
        base,
        tenant: "loki-bank",
        report: {
          status: "mismatch",
          stepId: "loan-payoff",
          expected: "Payoff Statement",
          observed: false,
          result: {
            status: "failure",
            capabilityId: "loan-payoff",
            code: "UNEXPECTED_STATE",
            runId: "run-end",
          },
        },
        specializer: {
          async specialize() {
            return { target: { strategies: [{ type: "visibleText", text: "X" }] } };
          },
        },
      }),
    ).rejects.toThrow(/rediscover the flow/);
  });
});

describe("assertBoundedAdaptPatch", () => {
  it("aborts when the patch would insert extra workflow steps", () => {
    const oversized: CapabilityOverride = {
      schemaVersion: "1.0",
      id: "loan-payoff-loki-bank",
      baseCapability: "loan-payoff",
      target: { tenant: "loki-bank" },
      overrides: {
        insertBefore: {
          "open-lending": [
            {
              id: "extra-1",
              preconditions: [],
              action: {
                type: "click",
                target: { strategies: [{ type: "visibleText", text: "A" }] },
              },
              postconditions: [],
            },
          ],
        },
      },
      provenance: {
        createdBy: "icas-adapt",
        reason: "too large",
      },
    };
    expect(() => assertBoundedAdaptPatch(oversized)).toThrow(/too large/);
  });
});
