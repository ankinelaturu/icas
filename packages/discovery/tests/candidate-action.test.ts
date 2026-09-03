/**
 * @file Tests for CandidateProposal schema validation.
 */

import { describe, expect, it } from "vitest";

import {
  assignCandidateIds,
  CandidateValidationError,
  sortCandidatesByRank,
  validateCandidateProposal,
} from "../src/candidate-action.js";
import { MINIMAL_SUCCESS_RESULT } from "./test-support/success-result.js";

const clickLending = {
  action: {
    type: "click" as const,
    target: {
      strategies: [{ type: "visibleText" as const, text: "Lending" }],
    },
    risk: "safe" as const,
  },
  rationale: "Lending is the loan workspace",
  rank: 1,
};

describe("validateCandidateProposal", () => {
  it("accepts a ranked continue proposal", () => {
    const proposal = validateCandidateProposal({
      status: "continue",
      candidates: [clickLending],
    });
    expect(proposal.status).toBe("continue");
    expect(proposal.candidates).toHaveLength(1);
    expect(proposal.candidates[0]?.action.type).toBe("click");
    expect(proposal.candidates[0]?.proposedInputParam).toBeUndefined();
    expect(proposal.candidates[0]?.possibleOutcomes).toBeUndefined();
  });

  it("rejects fill without proposedInputParam", () => {
    expect(() =>
      validateCandidateProposal({
        status: "continue",
        candidates: [
          {
            action: {
              type: "fill",
              target: { strategies: [{ type: "label", label: "Account" }] },
              value: { literal: "42" },
              risk: "safe",
            },
            rationale: "Enter the account",
            rank: 1,
          },
        ],
      }),
    ).toThrow(/proposedInputParam/);
  });

  it("rejects proposedInputParam on click", () => {
    expect(() =>
      validateCandidateProposal({
        status: "continue",
        candidates: [
          {
            ...clickLending,
            proposedInputParam: { name: "accountId", type: "string", required: true },
          },
        ],
      }),
    ).toThrow(/proposedInputParam/);
  });

  it("accepts fill with proposedInputParam", () => {
    const proposal = validateCandidateProposal({
      status: "continue",
      candidates: [
        {
          action: {
            type: "fill",
            target: { strategies: [{ type: "label", label: "Account" }] },
            value: { literal: "42" },
            risk: "safe",
          },
          rationale: "Enter the account",
          rank: 1,
          proposedInputParam: { name: "accountId", type: "string", required: true },
        },
      ],
    });
    expect(proposal.candidates[0]?.proposedInputParam).toEqual({
      name: "accountId",
      type: "string",
      required: true,
    });
    expect(proposal.candidates[0]?.action).not.toHaveProperty("proposedInputParam");
  });

  it("accepts possibleOutcomes on a click candidate", () => {
    const proposal = validateCandidateProposal({
      status: "continue",
      candidates: [
        {
          ...clickLending,
          possibleOutcomes: [
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
    expect(proposal.candidates[0]?.possibleOutcomes).toHaveLength(1);
    expect(proposal.candidates[0]?.possibleOutcomes?.[0]?.kind).toBe("error");
  });

  it("accepts success with a result contract and no further candidates", () => {
    const proposal = validateCandidateProposal({
      status: "success",
      candidates: [],
      rationale: "Payoff Statement is visible",
      result: MINIMAL_SUCCESS_RESULT,
    });
    expect(proposal.status).toBe("success");
    expect(proposal.result?.successSignals).toHaveLength(1);
  });

  it("rejects success without result", () => {
    expect(() =>
      validateCandidateProposal({
        status: "success",
        candidates: [],
      }),
    ).toThrow(/result/);
  });

  it("rejects free-form prose", () => {
    expect(() => validateCandidateProposal("click Lending then search")).toThrow(
      CandidateValidationError,
    );
  });

  it("rejects an unknown action type", () => {
    try {
      validateCandidateProposal({
        status: "continue",
        candidates: [
          {
            ...clickLending,
            action: { type: "hover", target: clickLending.action.target },
          },
        ],
      });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidateValidationError);
      expect((error as CandidateValidationError).message).toMatch(/action/i);
    }
  });

  it("rejects continue with an empty candidate list", () => {
    expect(() =>
      validateCandidateProposal({ status: "continue", candidates: [] }),
    ).toThrow(/at least one candidate/);
  });

  it("rejects continue when result is present", () => {
    expect(() =>
      validateCandidateProposal({
        status: "continue",
        candidates: [clickLending],
        result: MINIMAL_SUCCESS_RESULT,
      }),
    ).toThrow(/result is only valid/);
  });
});

describe("assignCandidateIds / sortCandidatesByRank", () => {
  it("fills missing ids and sorts rank 1 before rank 2", () => {
    const sorted = sortCandidatesByRank(
      assignCandidateIds([
        { ...clickLending, rank: 2, rationale: "Documents" },
        clickLending,
      ]),
    );
    expect(sorted.map((c) => c.rank)).toEqual([1, 2]);
    expect(sorted[0]?.id).toBe("cand-1-1");
    expect(sorted[1]?.id).toBe("cand-2-0");
  });
});
