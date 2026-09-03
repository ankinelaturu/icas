/**
 * @file formatRunResult prints nested details as indented JSON.
 */

import { describe, expect, it } from "vitest";

import { formatRunResult } from "../src/format-run-result.js";

describe("formatRunResult", () => {
  it("pretty-prints business_outcome details", () => {
    const text = formatRunResult({
      status: "business_outcome",
      capabilityId: "loan-payoff",
      outcome: "loan_inquiry_error",
      details: {
        heading: "Loan Inquiry Error",
        summary: "There was an error accessing the loan account details.",
        message: "No loan record found",
        match: {
          phrases: ["Loan not found", "No loan record found", "Invalid account number"],
        },
      },
      runId: "run-format-biz",
    });
    expect(text).toContain("outcome: loan_inquiry_error");
    expect(text).toContain("details: {");
    expect(text).toContain('  "heading": "Loan Inquiry Error"');
    expect(text).toContain('  "message": "No loan record found"');
    expect(text.indexOf('"message"')).toBeLessThan(text.indexOf('"match"'));
    expect(text).toContain('      "No loan record found"');
    expect(text).not.toContain('"phrase"');
    expect(text).not.toMatch(/details: \{".*"\}/);
  });
});
