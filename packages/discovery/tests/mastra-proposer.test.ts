/**
 * @file Mastra proposer tests — mocked generate, no live API.
 */

import { describe, expect, it } from "vitest";

import { CandidateValidationError } from "../src/candidate-action.js";
import {
  MastraCandidateProposer,
  type StructuredGenerateAgent,
} from "../src/mastra-proposer.js";

const validContinue = {
  status: "continue" as const,
  rationale: null,
  candidates: [
    {
      id: null,
      action: {
        type: "click" as const,
        intent: null,
        risk: "safe" as const,
        path: null,
        reason: null,
        value: null,
        proposedInputParam: null,
        target: {
          strategies: [
            {
              type: "visibleText" as const,
              role: null,
              text: "Lending",
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
      rationale: "Lending is the loan workspace",
      rank: 1,
      expectation: null,
      risk: null,
      possibleOutcomes: [],
    },
  ],
};

function mockAgent(object: unknown): StructuredGenerateAgent {
  return {
    generate: async () => ({ object }),
  };
}

describe("MastraCandidateProposer", () => {
  it("returns schema-validated candidates from a mocked model", async () => {
    const proposer = new MastraCandidateProposer(mockAgent(validContinue));
    const proposal = await proposer.propose({
      goal: "Generate a payoff statement",
      observation: { id: "home", url: "http://localhost:4101/" },
      history: [],
    });
    expect(proposal.status).toBe("continue");
    expect(proposal.candidates[0]?.rank).toBe(1);
  });

  it("passes sampling as generate modelSettings", async () => {
    let seen: unknown;
    const agent: StructuredGenerateAgent = {
      generate: async (_messages, options) => {
        seen = options.modelSettings;
        return { object: validContinue };
      },
    };
    const proposer = new MastraCandidateProposer(agent, {
      settings: {
        model: "openai/gpt-4o",
        apiKey: "sk",
        temperature: 0,
        maxOutputTokens: 1024,
      },
    });
    await proposer.propose({
      goal: "Generate a payoff statement",
      observation: { id: "home" },
      history: [],
    });
    expect(seen).toEqual({ temperature: 0, maxOutputTokens: 1024 });
  });

  it("rejects malformed model JSON", async () => {
    const proposer = new MastraCandidateProposer(mockAgent("just click lending"));
    await expect(
      proposer.propose({
        goal: "Generate a payoff statement",
        observation: { id: "home" },
        history: [],
      }),
    ).rejects.toBeInstanceOf(CandidateValidationError);
  });

  it("logs the raw generate object before mapping", async () => {
    const lines: string[] = [];
    const proposer = new MastraCandidateProposer(mockAgent(validContinue), {
      log: (line) => {
        lines.push(line);
      },
    });
    await proposer.propose({
      goal: "Generate a payoff statement",
      observation: { id: "home", url: "http://localhost:4101/" },
      history: [],
    });
    const joined = lines.join("\n");
    expect(joined).toContain("LLM generate observation=home");
    expect(joined).toContain("LLM user prompt:");
    expect(joined).toContain("Goal: Generate a payoff statement");
    expect(joined).toContain("LLM raw response:");
    expect(joined).toContain('"text": "Lending"');
  });

  it("prints agent instructions once across two generate calls", async () => {
    const lines: string[] = [];
    const proposer = new MastraCandidateProposer(mockAgent(validContinue), {
      log: (line) => {
        lines.push(line);
      },
      instructions: "Do not transfer funds.",
    });
    const context = {
      goal: "Generate a payoff statement",
      observation: { id: "home", url: "http://localhost:4101/" },
      history: [],
    };
    await proposer.propose(context);
    await proposer.propose({ ...context, observation: { id: "lending" } });
    const instructionHits = lines.filter((line) => line.includes("LLM agent instructions")).length;
    expect(instructionHits).toBe(1);
    expect(lines.join("\n")).toContain("Do not transfer funds.");
  });
});

describe("createConfiguredDiscoveryProposer", () => {
  it("folds prompt policy into Mastra agent instructions", async () => {
    const { createConfiguredDiscoveryProposer } = await import("../src/mastra-proposer.js");
    const configured = await createConfiguredDiscoveryProposer({
      promptPolicy: "Do not transfer funds.",
      model: "openai/gpt-4o",
    });
    expect(configured.model).toBe("openai/gpt-4o");
    expect(configured.instructions).toContain("Do not transfer funds.");
    expect(configured.instructions).toContain("structured-output schema");
  });
});
