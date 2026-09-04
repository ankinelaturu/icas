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
      result: null,
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
              ref: null,
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
      result: null,
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
              ref: null,
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

  it("maps success result locators onto catalog extract targets", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "success",
      rationale: null,
      result: {
        successSignals: [
          { type: "textVisible", value: "Statement ready", pattern: null },
          { type: "urlMatches", value: null, pattern: "/lending/payoff.htm" },
        ],
        outputs: [
          {
            name: "totalAmount",
            type: "money",
            description: "Quoted total",
            source: {
              ref: null,
              strategies: [
                {
                  ...nullStrategyFields,
                  type: "relative",
                  text: "Total amount",
                },
              ],
            },
          },
        ],
      },
      candidates: [],
    });
    expect(proposal.result?.successSignals).toEqual([
      { type: "textVisible", value: "Statement ready" },
      { type: "urlMatches", pattern: "/lending/payoff.htm" },
    ]);
    expect(proposal.result?.outputs[0]).toMatchObject({
      name: "totalAmount",
      type: "money",
      extract: {
        target: { strategies: [{ type: "relative", text: "Total amount" }] },
      },
    });
  });

  it("ignores snapshot refs on success outputs so bind cannot stamp this-run amounts", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "success",
      rationale: "Statement visible",
      result: {
        successSignals: [{ type: "textVisible", value: "Statement ready", pattern: null }],
        outputs: [
          {
            name: "principalBalance",
            type: "money",
            description: null,
            source: {
              ref: "f6e64",
              strategies: [
                { ...nullStrategyFields, type: "relative", text: "Principal Balance" },
              ],
            },
          },
        ],
      },
      candidates: [],
    });
    expect(proposal.result?.outputs[0]).toEqual({
      name: "principalBalance",
      type: "money",
      extract: {
        target: { strategies: [{ type: "relative", text: "Principal Balance" }] },
      },
    });
    expect(proposal.result?.outputs[0]).not.toHaveProperty("snapshotRef");
  });

  it("rejects success when result is null", () => {
    expect(() =>
      llmProposalToCandidateProposal({
        status: "success",
        rationale: "done",
        result: null,
        candidates: [],
      }),
    ).toThrow(CandidateValidationError);
  });

  it("rejects continue when result is non-null", () => {
    expect(() =>
      llmProposalToCandidateProposal({
        status: "continue",
        rationale: null,
        result: {
          successSignals: [{ type: "textVisible", value: "Home", pattern: null }],
          outputs: [],
        },
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
                ref: null,
                strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Lending" }],
              },
            },
            rationale: "Open lending",
            rank: 1,
            expectation: null,
            risk: null,
            possibleOutcomes: [],
          },
        ],
      }),
    ).toThrow(CandidateValidationError);
  });

  it("rejects fill when proposedInputParam is null", () => {
    expect(() =>
      llmProposalToCandidateProposal({
        status: "continue",
        rationale: null,
        result: null,
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
                ref: null,
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

  it("copies a snapshot ref onto the candidate, not the catalog action", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "continue",
      rationale: null,
      result: null,
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
              ref: "e12",
              strategies: [
                { ...nullStrategyFields, type: "visibleText", text: "Share Holds Place a hold on available funds" },
              ],
            },
          },
          rationale: "Open share holds",
          rank: 1,
          expectation: null,
          risk: null,
          possibleOutcomes: [],
        },
      ],
    });
    expect(proposal.candidates[0]?.snapshotRef).toBe("e12");
    expect(proposal.candidates[0]?.action).toEqual({
      type: "click",
      target: {
        strategies: [
          { type: "visibleText", text: "Share Holds Place a hold on available funds" },
        ],
      },
      risk: "safe",
    });
  });

  it("maps roleText with a null role when a snapshot ref is present", () => {
    const proposal = llmProposalToCandidateProposal({
      status: "continue",
      rationale: null,
      result: null,
      candidates: [
        {
          id: "1",
          action: {
            type: "click",
            intent: null,
            risk: "safe",
            path: null,
            reason: "Open share holds",
            value: null,
            proposedInputParam: null,
            target: {
              ref: "e15",
              strategies: [
                { ...nullStrategyFields, type: "roleText", text: "Share Holds" },
              ],
            },
          },
          rationale: "Clicking Share Holds is the hold path",
          rank: 1,
          expectation: null,
          risk: "safe",
          possibleOutcomes: [],
        },
      ],
    });
    expect(proposal.candidates[0]?.snapshotRef).toBe("e15");
    expect(proposal.candidates[0]?.action).toEqual({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Share Holds" }] },
      risk: "safe",
    });
  });

  it("rejects a snapshot ref that is not an eN token", () => {
    expect(() =>
      llmProposalToCandidateProposal({
        status: "continue",
        rationale: null,
        result: null,
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
                ref: "Share Holds",
                strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Share Holds" }],
              },
            },
            rationale: "Open share holds",
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
