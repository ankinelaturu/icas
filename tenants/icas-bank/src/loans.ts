/**
 * @file Deterministic synthetic loan records and payoff math for icas-bank.
 */

/** Institution processing date. Not wall-clock, so replay stays stable. */
export const SYSTEM_DATE = "2026-08-28";

export type LoanStatus = "Active" | "Paid Off";

export interface LoanRecord {
  readonly loanAccountId: string;
  readonly borrowerName: string;
  readonly status: LoanStatus;
  readonly principalBalance: number;
  readonly perDiemInterest: number;
  readonly interestRatePct: number;
  readonly originationDate: string;
  readonly maturityDate: string;
  readonly productDesc: string;
  readonly branch: string;
}

export interface PayoffQuote {
  readonly loanAccountId: string;
  readonly payoffDate: string;
  readonly days: number;
  readonly principalBalance: string;
  readonly perDiemInterest: string;
  readonly interestThroughPayoff: string;
  readonly totalPayoffAmount: string;
}

const LOANS: readonly LoanRecord[] = [
  {
    loanAccountId: "987654",
    borrowerName: "RIVERA, A",
    status: "Active",
    principalBalance: 12450,
    perDiemInterest: 3.45,
    interestRatePct: 6.25,
    originationDate: "2021-03-15",
    maturityDate: "2031-03-15",
    productDesc: "CN INSTL — AUTO",
    branch: "001",
  },
  {
    loanAccountId: "112233",
    borrowerName: "CHEN, M",
    status: "Active",
    principalBalance: 8800,
    perDiemInterest: 1.92,
    interestRatePct: 5.9,
    originationDate: "2022-11-01",
    maturityDate: "2028-11-01",
    productDesc: "CN INSTL — PERS",
    branch: "001",
  },
  {
    loanAccountId: "555555",
    borrowerName: "OKAFOR, T",
    status: "Paid Off",
    principalBalance: 0,
    perDiemInterest: 0,
    interestRatePct: 7.1,
    originationDate: "2018-06-20",
    maturityDate: "2024-06-20",
    productDesc: "CN INSTL — AUTO",
    branch: "003",
  },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Look up a loan by account id. Unknown ids return undefined (not-found page).
 */
export function getLoan(loanAccountId: string): LoanRecord | undefined {
  const id = loanAccountId.trim();
  return LOANS.find((loan) => loan.loanAccountId === id);
}

/**
 * Format a dollar amount as a two-decimal string with no grouping.
 */
export function formatMoney(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Parse YYYY-MM-DD or M/D/YYYY into a UTC calendar date.
 *
 * @returns The date, or undefined if the string is not a real calendar day
 */
export function parsePayoffDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const us = US_DATE.exec(trimmed);
    if (!us) {
      return undefined;
    }
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  }
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Compute a formal payoff quote as of SYSTEM_DATE through payoffDate (inclusive of elapsed days).
 *
 * @throws If the loan is missing, not Active, or the payoff date is before SYSTEM_DATE
 */
export function calculatePayoff(
  loan: LoanRecord,
  payoffDateRaw: string,
): PayoffQuote {
  if (loan.status !== "Active") {
    throw new PayoffNotEligibleError(loan.loanAccountId, loan.status);
  }
  const payoffDate = parsePayoffDate(payoffDateRaw);
  if (payoffDate === undefined) {
    throw new InvalidPayoffDateError(payoffDateRaw);
  }
  const days = calendarDays(SYSTEM_DATE, payoffDate);
  if (days < 0) {
    throw new PayoffDateInPastError(payoffDate);
  }
  const interest = roundMoney(loan.perDiemInterest * days);
  const total = roundMoney(loan.principalBalance + interest);
  return {
    loanAccountId: loan.loanAccountId,
    payoffDate,
    days,
    principalBalance: formatMoney(loan.principalBalance),
    perDiemInterest: formatMoney(loan.perDiemInterest),
    interestThroughPayoff: formatMoney(interest),
    totalPayoffAmount: formatMoney(total),
  };
}

export class PayoffNotEligibleError extends Error {
  constructor(
    readonly loanAccountId: string,
    readonly status: LoanStatus,
  ) {
    super(`Payoff not available for ${loanAccountId} (${status})`);
    this.name = "PayoffNotEligibleError";
  }
}

export class InvalidPayoffDateError extends Error {
  constructor(readonly raw: string) {
    super("Payoff date is not a valid calendar date");
    this.name = "InvalidPayoffDateError";
  }
}

export class PayoffDateInPastError extends Error {
  constructor(readonly payoffDate: string) {
    super(`Payoff date ${payoffDate} is before processing date ${SYSTEM_DATE}`);
    this.name = "PayoffDateInPastError";
  }
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function calendarDays(fromIso: string, toIso: string): number {
  const from = utcDay(fromIso);
  const to = utcDay(toIso);
  return Math.round((to - from) / 86_400_000);
}

function utcDay(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new Error(`expected ISO date, got ${iso}`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
