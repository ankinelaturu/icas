/**
 * @file Header-only vs one-step icas-adapt override construction.
 */

import { describe, expect, it } from "vitest";

import type { CapabilityArtifact, CapabilityOverride } from "@icas/capability";

import { assertBoundedAdaptPatch, buildAdaptOverride } from "../src/build-override.js";
import { NEXT_ACTION_TARGET_MISSING } from "@icas/replay";

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

  it("passes captured page text to the specializer", async () => {
    let seen = "";
    await buildAdaptOverride({
      base,
      tenant: "icas-banc",
      pageText: "Look Up",
      report: {
        status: "mismatch",
        stepId: "open-lending",
        expected: "Inquire",
        observed: false,
        result: {
          status: "failure",
          capabilityId: "loan-payoff",
          code: "TARGET_NOT_FOUND",
          stepId: "open-lending",
          runId: "run-page",
        },
      },
      specializer: {
        async specialize({ pageText }) {
          seen = pageText;
          return {
            target: { strategies: [{ type: "visibleText", text: "Look Up" }] },
          };
        },
      },
    });
    expect(seen).toBe("Look Up");
  });

  it("fails closed on mismatch when no specializer is injected", async () => {
    await expect(
      buildAdaptOverride({
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
            runId: "run-no-llm",
          },
        },
      }),
    ).rejects.toThrow(/ICAS_ADAPT_LLM/);
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

  it("patches the next click when UNEXPECTED_STATE names the prior fill", async () => {
    const twoStep = {
      ...base,
      steps: [
        {
          id: "fill-ln-acct",
          preconditions: [],
          action: {
            type: "fill" as const,
            target: { strategies: [{ type: "relative" as const, text: "LN Acct #" }] },
            value: { input: "loanAccountNumber" },
          },
          postconditions: [],
        },
        {
          id: "click-inquire",
          preconditions: [],
          action: {
            type: "click" as const,
            target: {
              strategies: [{ type: "roleText" as const, role: "button", text: "Inquire" }],
            },
          },
          postconditions: [],
        },
      ],
    } as CapabilityArtifact;
    let specializedId = "";
    const override = await buildAdaptOverride({
      base: twoStep,
      tenant: "icas-banc",
      report: {
        status: "mismatch",
        stepId: "fill-ln-acct",
        expected: twoStep.steps[1]!.action,
        observed: NEXT_ACTION_TARGET_MISSING,
        result: {
          status: "failure",
          capabilityId: "loan-payoff",
          code: "UNEXPECTED_STATE",
          stepId: "fill-ln-acct",
          expected: twoStep.steps[1]!.action,
          observed: NEXT_ACTION_TARGET_MISSING,
          runId: "run-next-miss",
        },
      },
      specializer: {
        async specialize({ step }) {
          specializedId = step.id;
          return {
            target: {
              strategies: [
                { type: "roleText", role: "button", text: "Look Up" },
                { type: "visibleText", text: "Look Up" },
              ],
            },
          };
        },
      },
    });
    expect(specializedId).toBe("click-inquire");
    expect(Object.keys(override.overrides.steps ?? {})).toEqual(["click-inquire"]);
    expect(override.overrides.steps?.["click-inquire"]?.target?.strategies[0]).toMatchObject({
      text: "Look Up",
    });
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
