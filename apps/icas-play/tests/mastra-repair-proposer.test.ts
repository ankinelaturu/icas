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
    pageText: "Search Loan Account\nLook Up\nLoan Account",
  };
}

function lookUpLlmObject() {
  return {
    actions: [
      {
        type: "click" as const,
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
              type: "visibleText" as const,
              role: null,
              text: "Look Up",
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
    rationale: "Inquire was renamed Look Up",
  };
}

/**
 * Shape Mastra returns at runtime: structured `object`, escaped JSON in
 * `text`, plus nested usage/steps/messages that must not dump to stdout.
 */
function mastraGenerateResult(object: ReturnType<typeof lookUpLlmObject>) {
  return {
    object,
    text: JSON.stringify(object),
    usage: {
      inputTokens: 1200,
      outputTokens: 80,
      totalTokens: 1280,
      raw: { raw: { usage: { prompt_tokens: 1200 } } },
    },
    steps: [{ type: "tool", text: JSON.stringify(object) }],
    messages: {
      all: [{ role: "user", content: "full prompt echo open-lending" }],
    },
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

  it("logs system instructions, exact user prompt, and structured response", async () => {
    const lines: string[] = [];
    const proposer = new MastraRepairProposer(
      {
        generate: async () => mastraGenerateResult(lookUpLlmObject()),
      },
      {
        settings: { model: "openai/gpt-4o", apiKey: "sk-secret-do-not-print", temperature: 0 },
        instructions: "SYSTEM CONTRACT TEXT",
        log: (line) => {
          lines.push(line);
        },
      },
    );
    await proposer.propose(fakeContext());
    const dump = lines.join("\n");
    expect(dump).toContain("LLM generate step=open-lending");
    expect(dump).toContain("pageTextChars=");
    expect(dump).toContain("Look Up");
    expect(dump).toContain("LLM agent instructions (system):");
    expect(dump).toContain("SYSTEM CONTRACT TEXT");
    expect(dump).toContain("LLM user prompt (exact generate message):");
    expect(dump).toContain("open-lending");
    expect(dump).toContain("LLM response:");
    expect(dump).toContain("LLM usage: input=1200 output=80 total=1280");
    expect(dump).toContain('"text": "Look Up"');
    expect(dump).toContain("LLM rationale:");
    expect(dump).toContain("LLM mapped RepairProposal:");
    expect(dump).not.toContain("LLM raw response:");
    expect(dump).not.toContain("prompt_tokens");
    expect(dump).not.toContain("full prompt echo");
    expect(dump).not.toContain("sk-secret-do-not-print");
    expect(dump).toContain('"hasApiKey": true');
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

  it("includes the failed step id and visible page chrome in the prompt", () => {
    const prompt = formatRepairPrompt(fakeContext());
    expect(prompt).toContain("open-lending");
    expect(prompt).toContain("Visible page text:");
    expect(prompt).toContain("Look Up");
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
