/**
 * @file Mastra repair proposer returns a schema-valid RepairProposal.
 */

import { describe, expect, it } from "vitest";

import {
  formatRepairPrompt,
  hasRepairApiKey,
  MastraRepairProposer,
  RepairProposalSchema,
  resolveRepairModel,
} from "../src/mastra-repair-proposer.js";
import type { RepairContext } from "@icas/replay";

const click = {
  type: "click" as const,
  target: { strategies: [{ type: "visibleText" as const, text: "Retry" }] },
};

function fakeContext(): RepairContext {
  return {
    step: {
      id: "open-lending",
      preconditions: [],
      action: click,
      postconditions: [{ type: "textVisible", value: "Lending Services" }],
    },
    capability: {
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
          action: click,
          postconditions: [{ type: "textVisible", value: "Lending Services" }],
        },
      ],
      success: [{ type: "textVisible", value: "Payoff Statement" }],
    },
    failure: {
      status: "failure",
      capabilityId: "loan-payoff",
      code: "TARGET_NOT_FOUND",
      stepId: "open-lending",
      runId: "run-1",
    },
    observation: { id: "obs-1", imagePath: "/tmp/x.png" },
  };
}

describe("MastraRepairProposer", () => {
  it("validates structured output before returning", async () => {
    const proposer = new MastraRepairProposer({
      generate: async () => ({
        object: {
          actions: [
            {
              type: "click",
              intent: null,
              risk: null,
              path: null,
              reason: null,
              value: null,
              proposedInputParam: null,
              target: {
                ref: null,
                strategies: [
                  {
                    type: "visibleText",
                    role: null,
                    text: "Retry",
                    label: null,
                    selector: null,
                    xpath: null,
                    x: null,
                    y: null,
                    confidence: null,
                  },
                ],
              },
            },
          ],
          rationale: "retry the visible control",
        },
      }),
    });
    const proposal = await proposer.propose(fakeContext());
    expect(proposal.actions).toHaveLength(1);
    expect(proposal.rationale).toMatch(/retry/);
  });

  it("passes sampling as generate modelSettings", async () => {
    let seen: unknown;
    const proposer = new MastraRepairProposer(
      {
        generate: async (_messages, options) => {
          seen = options.modelSettings;
          return {
            object: {
              actions: [
                {
                  type: "click",
                  intent: null,
                  risk: null,
                  path: null,
                  reason: null,
                  value: null,
                  proposedInputParam: null,
                  target: {
                    ref: null,
                    strategies: [
                      {
                        type: "visibleText",
                        role: null,
                        text: "Retry",
                        label: null,
                        selector: null,
                        xpath: null,
                        x: null,
                        y: null,
                        confidence: null,
                      },
                    ],
                  },
                },
              ],
              rationale: "retry the visible control",
            },
          };
        },
      },
      { settings: { model: "openai/gpt-4o", apiKey: "sk", temperature: 0 } },
    );
    await proposer.propose(fakeContext());
    expect(seen).toEqual({ temperature: 0 });
  });

  it("rejects prose-shaped output", async () => {
    const proposer = new MastraRepairProposer({
      generate: async () => ({ object: { text: "just click around" } }),
    });
    await expect(proposer.propose(fakeContext())).rejects.toThrow(/invalid RepairProposal/);
  });
});

describe("repair helpers", () => {
  it("honors ICAS_ASSIST_LLM_MODEL", () => {
    expect(
      resolveRepairModel({
        ICAS_ASSIST_LLM_MODEL: "openai/gpt-4o-mini",
      }),
    ).toBe("openai/gpt-4o-mini");
  });

  it("detects ICAS_ASSIST_LLM_*", () => {
    expect(hasRepairApiKey({})).toBe(false);
    expect(hasRepairApiKey({ ICAS_ASSIST_LLM_API_KEY: "sk-test" })).toBe(true);
    expect(
      hasRepairApiKey({ ICAS_ASSIST_LLM_BASE_URL: "http://127.0.0.1:1234/v1" }),
    ).toBe(true);
  });

  it("includes the failed step id in the prompt", () => {
    expect(formatRepairPrompt(fakeContext())).toContain("open-lending");
  });

  it("accepts a valid RepairProposal schema", () => {
    expect(
      RepairProposalSchema.parse({
        actions: [click],
        rationale: "bounded repair",
      }).actions[0]?.type,
    ).toBe("click");
  });
});
