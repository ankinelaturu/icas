/**
 * @file Tests for deterministic icas-banc payoff math.
 */

import { describe, expect, it } from "vitest";

import {
  calculatePayoff,
  getLoan,
  InvalidPayoffDateError,
  type LoanRecord,
  PayoffDateInPastError,
  PayoffNotEligibleError,
  parsePayoffDate,
  SYSTEM_DATE,
} from "../src/loans.js";

describe("getLoan", () => {
  it("returns the known active demo loan", () => {
    expect(getLoan("987654")?.status).toBe("Active");
  });

  it("returns undefined for an unknown id", () => {
    expect(getLoan("000000")).toBeUndefined();
  });
});

describe("parsePayoffDate", () => {
  it("accepts ISO and US calendar dates", () => {
    expect(parsePayoffDate("2026-09-30")).toBe("2026-09-30");
    expect(parsePayoffDate("9/30/2026")).toBe("2026-09-30");
  });

  it("rejects impossible days", () => {
    expect(parsePayoffDate("2026-02-30")).toBeUndefined();
    expect(parsePayoffDate("not-a-date")).toBeUndefined();
  });
});

describe("calculatePayoff", () => {
  it("quotes 987654 through 2026-09-30 from the fixed processing date", () => {
    const loan = requireLoan("987654");
    const quote = calculatePayoff(loan, "2026-09-30");
    expect(SYSTEM_DATE).toBe("2026-08-28");
    expect(quote.days).toBe(33);
    expect(quote.principalBalance).toBe("12450.00");
    expect(quote.perDiemInterest).toBe("3.45");
    expect(quote.interestThroughPayoff).toBe("113.85");
    expect(quote.totalPayoffAmount).toBe("12563.85");
  });

  it("refuses a paid-off account", () => {
    expect(() => calculatePayoff(requireLoan("555555"), "2026-09-30")).toThrow(
      PayoffNotEligibleError,
    );
  });

  it("refuses a payoff date before processing date", () => {
    expect(() => calculatePayoff(requireLoan("987654"), "2026-01-01")).toThrow(
      PayoffDateInPastError,
    );
  });

  it("refuses an invalid date string", () => {
    expect(() => calculatePayoff(requireLoan("987654"), "tomorrow")).toThrow(
      InvalidPayoffDateError,
    );
  });
});

function requireLoan(id: string): LoanRecord {
  const loan = getLoan(id);
  if (loan === undefined) {
    throw new Error(`expected loan ${id}`);
  }
  return loan;
}
