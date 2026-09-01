/**
 * @file MCP formats replay business_outcome copy; it does not rematch the page.
 */

import { describe, expect, it } from "vitest";

import { formatMcpToolResult } from "../src/format-tool-result.js";

describe("formatMcpToolResult", () => {
  it("surfaces heading, summary, and the phrase that hit on business_outcome", () => {
    const formatted = formatMcpToolResult({
      status: "business_outcome",
      capabilityId: "loan-payoff",
      outcome: "loan_not_found",
      details: {
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
        match: { phrases: ["Loan not found"] },
        phrase: "Loan not found",
      },
      runId: "run-mcp-biz",
    });
    expect(formatted.isError).toBeUndefined();
    const text = formatted.content[0]?.text ?? "";
    expect(text).toContain("Loan not found");
    expect(text).toContain("No loan matches the requested account id.");
    expect(text).toContain("Matched: Loan not found");
    expect(text).toContain('"status":"business_outcome"');
    expect(text).not.toMatch(/screenshot|\.png/i);
  });

  it("marks engine failures as protocol errors", () => {
    const formatted = formatMcpToolResult({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "TARGET_NOT_FOUND",
      runId: "run-mcp-fail",
    });
    expect(formatted.isError).toBe(true);
  });
});
