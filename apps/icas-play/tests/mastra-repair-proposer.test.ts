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
              target: {
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

  it("rejects prose-shaped output", async () => {
    const proposer = new MastraRepairProposer({
      generate: async () => ({ object: { text: "just click around" } }),
    });
    await expect(proposer.propose(fakeContext())).rejects.toThrow(/invalid RepairProposal/);
  });
});

describe("repair helpers", () => {
  it("prefers ICAS_MODEL over the default", () => {
    expect(resolveRepairModel({ ICAS_MODEL: "anthropic/claude-sonnet-4-6" })).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });

  it("detects provider keys", () => {
    expect(hasRepairApiKey({})).toBe(false);
    expect(hasRepairApiKey({ OPENAI_API_KEY: "sk-test" })).toBe(true);
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
