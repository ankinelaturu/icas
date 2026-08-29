/**
 * @file business-outcomes — map visible domain messages to structured outcomes.
 */

export interface KnownBusinessOutcome {
  outcome: string;
  text: string;
}

/**
 * Domain results that must not be reported as Playwright/runtime crashes.
 */
export const KNOWN_BUSINESS_OUTCOMES: readonly KnownBusinessOutcome[] = [
  { outcome: "LOAN_NOT_FOUND", text: "Loan not found" },
  { outcome: "PAYOFF_NOT_AVAILABLE", text: "Payoff not available" },
  { outcome: "INVALID_PAYOFF_DATE", text: "Invalid payoff date" },
  { outcome: "LOAN_ALREADY_PAID", text: "Loan already paid" },
];
