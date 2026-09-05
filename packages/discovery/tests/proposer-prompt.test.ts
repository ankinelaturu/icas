/**
 * @file Discovery proposer prompt tests — contract text, no LLM SDK.
 */

import { describe, expect, it } from "vitest";

import {
  composeDiscoveryProposerInstructions,
  DISCOVERY_PROPOSER_INSTRUCTIONS,
  formatProposePrompt,
} from "../src/proposer-prompt.js";

describe("DISCOVERY_PROPOSER_INSTRUCTIONS", () => {
  it("states the ranking contract without product field names", () => {
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("status: \"continue\"");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain('type "relative"');
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("possibleOutcomes");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("match.phrases");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("staff-facing back-office");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("proposedInputParam");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("camelCase");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).not.toContain("loanAccountId");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).not.toContain("payoffDate");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("bounded graph search");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("materially different");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).not.toContain("payoff statement");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).not.toContain("After execute, ICAS asserts");
  });

  it("requires a compile-shaped success result, not a harvest read", () => {
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("REPLAY MATCHERS");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("looks like PII");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("Do not return snapshot text as-is");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("longest such span");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("Captions are chrome");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain('"type": "textVisible"');
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain('"pattern": null');
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("single line");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("result.outputs[].source.ref must be null");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("Do not propose a 'read' action solely");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain(
      "you MUST declare them. Empty outputs is not allowed in that case.",
    );
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("[ref=eN]");
    expect(DISCOVERY_PROPOSER_INSTRUCTIONS).toContain("target.ref");
  });
});

describe("composeDiscoveryProposerInstructions", () => {
  it("puts packaged policy before the ranking contract", () => {
    const instructions = composeDiscoveryProposerInstructions("Do not transfer funds.");
    expect(instructions.startsWith("Do not transfer funds.")).toBe(true);
    expect(instructions).toContain("structured-output schema");
  });
});

describe("formatProposePrompt", () => {
  it("includes goal, observation, search history, and the success result reminder", () => {
    const prompt = formatProposePrompt({
      goal: "quote loan 987654",
      observation: { id: "obs", url: "http://localhost:4101/", imagePath: "/tmp/a.png" },
      history: ["clicked Lending"],
      promptPolicy: "Do not transfer funds.",
    });
    expect(prompt).toContain("quote loan 987654");
    expect(prompt).toContain("Do not transfer funds.");
    expect(prompt).toContain("/tmp/a.png");
    expect(prompt).toContain("accessibilitySnapshot:");
    expect(prompt).toContain("Search history:");
    expect(prompt).toContain("one chrome line");
    expect(prompt).toContain("Do not return snapshot text as-is");
    expect(prompt).toContain("longest contiguous chrome substring");
    expect(prompt).not.toContain("ICAS");
  });

  it("renders empty history and omits a blank policy header", () => {
    const prompt = formatProposePrompt({
      goal: "quote loan 987654",
      observation: { id: "home" },
      history: [],
    });
    expect(prompt).toContain("Search history:\n(none)");
    expect(prompt).not.toContain("Prompt policy:");
  });
});
