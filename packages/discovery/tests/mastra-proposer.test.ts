/**
 * @file Mastra proposer tests — mocked generate, no live API.
 */

import { describe, expect, it } from "vitest";

import { CandidateValidationError } from "../src/candidate-action.js";
import {
  DISCOVERY_PROPOSER_INSTRUCTIONS,
  formatProposePrompt,
  MastraCandidateProposer,
  type StructuredGenerateAgent,
} from "../src/mastra-proposer.js";

const validContinue = {
  status: "continue" as const,
  candidates: [
    {
      action: {
        type: "click" as const,
        target: {
          strategies: [{ type: "visibleText" as const, text: "Lending" }],
        },
        risk: "safe" as const,
      },
      rationale: "Lending is the loan workspace",
      rank: 1,
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
});

describe("formatProposePrompt", () => {
  it("includes goal, observation, and proposer instructions contract", () => {
    const prompt = formatProposePrompt({
      goal: "quote loan 987654",
      observation: { id: "obs", url: "http://localhost:4101/", imagePath: "/tmp/a.png" },
      history: ["clicked Lending"],
      promptPolicy: "Do not transfer funds.",
    });
    expect(prompt).toContain("quote loan 987654");
    expect(prompt).toContain("Do not transfer funds.");
    expect(prompt).toContain("/tmp/a.png");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("status: \"continue\"");
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
    expect(configured.instructions).toContain("JSON object matching this contract");
  });
});
