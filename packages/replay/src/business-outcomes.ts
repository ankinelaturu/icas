/**
 * @file business-outcomes — map visible domain messages to structured outcomes.
 *
 * Callers must learn "loan not found" as a result, not a Playwright crash.
 * Classification runs on postcondition miss, before a hard failure code.
 */

/**
 * One fixture message and the outcome id returned on {@link ExecutionResult}.
 */
export interface KnownBusinessOutcome {
  outcome: string;
  text: string;
}

/**
 * Domain results that must not be reported as Playwright/runtime crashes.
 *
 * First visible match wins. The synthetic bank shows at most one of these.
 */
export const KNOWN_BUSINESS_OUTCOMES: readonly KnownBusinessOutcome[] = [
  { outcome: "LOAN_NOT_FOUND", text: "Loan not found" },
  { outcome: "PAYOFF_NOT_AVAILABLE", text: "Payoff not available" },
  { outcome: "INVALID_PAYOFF_DATE", text: "Invalid payoff date" },
  { outcome: "LOAN_ALREADY_PAID", text: "Loan already paid" },
];
