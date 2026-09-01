/**
 * @file llmProposalToCandidateProposal copies proposedInputParam onto the candidate.
 */

import { describe, expect, it } from "vitest";

import { CandidateValidationError } from "../src/candidate-action.js";
import { llmProposalToCandidateProposal } from "../src/llm-proposal-schema.js";

const nullStrategyFields = {
  role: null,
  text: null,
  label: null,
  selector: null,
  xpath: null,
  x: null,
  y: null,
  confidence: null,
};

describe("llmProposalToCandidateProposal", () => {
  it("copies proposedInputParam onto a fill candidate, not the catalog action", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "continue",
      rationale: null,
      candidates: [
        {
          id: null,
          action: {
            type: "fill",
            intent: null,
            risk: "safe",
            path: null,
            reason: null,
            value: "42",
            proposedInputParam: { name: "accountId", type: "string", required: true },
            target: {
              strategies: [{ ...nullStrategyFields, type: "label", label: "Account" }],
            },
          },
          rationale: "Enter the account from the goal",
          rank: 1,
          expectation: null,
          risk: null,
          possibleOutcomes: [],
        },
      ],
    });
    expect(proposal.candidates[0]?.proposedInputParam).toEqual({
      name: "accountId",
      type: "string",
      required: true,
    });
    expect(proposal.candidates[0]?.action).toMatchObject({
      type: "fill",
      value: { literal: "42" },
    });
    expect(proposal.candidates[0]?.action).not.toHaveProperty("proposedInputParam");
  });

  it("copies possibleOutcomes onto the candidate", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "continue",
      rationale: null,
      candidates: [
        {
          id: null,
          action: {
            type: "click",
            intent: null,
            risk: "safe",
            path: null,
            reason: null,
            value: null,
            proposedInputParam: null,
            target: {
              strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Inquire" }],
            },
          },
          rationale: "Submit the search",
          rank: 1,
          expectation: null,
          risk: null,
          possibleOutcomes: [
            {
              kind: "success",
              match: { phrases: ["Loan Details"] },
              heading: null,
              summary: null,
            },
            {
              kind: "error",
              match: { phrases: ["Loan not found"] },
              heading: "Loan not found",
              summary: "No loan matches the requested account id.",
            },
          ],
        },
      ],
    });
    expect(proposal.candidates[0]?.possibleOutcomes).toEqual([
      {
        kind: "success",
        match: { phrases: ["Loan Details"] },
        heading: null,
        summary: null,
      },
      {
        kind: "error",
        match: { phrases: ["Loan not found"] },
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
      },
    ]);
  });

  it("rejects fill when proposedInputParam is null", () => {
    expect(() =>
      llmProposalToCandidateProposal({
        status: "continue",
        rationale: null,
        candidates: [
          {
            id: null,
            action: {
              type: "fill",
              intent: null,
              risk: "safe",
              path: null,
              reason: null,
              value: "42",
              proposedInputParam: null,
              target: {
                strategies: [{ ...nullStrategyFields, type: "label", label: "Account" }],
              },
            },
            rationale: "Enter the account",
            rank: 1,
            expectation: null,
            risk: null,
            possibleOutcomes: [],
          },
        ],
      }),
    ).toThrow(CandidateValidationError);
  });
});
