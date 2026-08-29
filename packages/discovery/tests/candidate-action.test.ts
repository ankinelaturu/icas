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
  });

  it("accepts success with no further candidates", () => {
    const proposal = validateCandidateProposal({
      status: "success",
      candidates: [],
      rationale: "Payoff Statement is visible",
    });
    expect(proposal.status).toBe("success");
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
