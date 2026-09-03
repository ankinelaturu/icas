/**
 * @file Deterministic synthetic members, shares, and hold quotes for helix-cu.
 *
 * Fake book of business only — no real members or PII. Holds reduce
 * available balance; they do not transfer or pay.
 */

/** Institution processing date. Not wall-clock, so replay stays stable. */
export const SYSTEM_DATE = "2026-09-03";

/** Days a demo hold stays in force after it is placed. */
export const HOLD_TERM_DAYS = 7;

export interface ShareRecord {
  readonly shareId: string;
  readonly description: string;
  readonly ledgerBalance: number;
  readonly availableBalance: number;
}

export interface MemberRecord {
  readonly memberId: string;
  readonly shortName: string;
  readonly branch: string;
  readonly shares: readonly ShareRecord[];
}

export interface HoldQuote {
  readonly memberId: string;
  readonly shareId: string;
  readonly holdAmount: string;
  readonly availableAfter: string;
  readonly holdConfirmationId: string;
  readonly holdExpires: string;
  readonly reason: string;
  readonly processingDate: string;
}

const MEMBERS: readonly MemberRecord[] = [
  {
    memberId: "441122",
    shortName: "HALE, J",
    branch: "012",
    shares: [
      {
        shareId: "01",
        description: "Primary Share",
        ledgerBalance: 1840.5,
        availableBalance: 1840.5,
      },
      {
        shareId: "02",
        description: "Holiday Club",
        ledgerBalance: 320,
        availableBalance: 320,
      },
    ],
  },
  {
    memberId: "330198",
    shortName: "NGUYEN, P",
    branch: "012",
    shares: [
      {
        shareId: "01",
        description: "Primary Share",
        ledgerBalance: 5125,
        availableBalance: 5125,
      },
    ],
  },
];

const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Look up a member by id. Unknown ids return undefined (not-found page).
 */
export function getMember(memberId: string): MemberRecord | undefined {
  const id = memberId.trim();
  return MEMBERS.find((member) => member.memberId === id);
}

/**
 * Look up one share on a member. Missing member or share returns undefined.
 */
export function getShare(
  memberId: string,
  shareId: string,
): { member: MemberRecord; share: ShareRecord } | undefined {
  const member = getMember(memberId);
  if (member === undefined) {
    return undefined;
  }
  const share = member.shares.find((row) => row.shareId === shareId.trim());
  if (share === undefined) {
    return undefined;
  }
  return { member, share };
}

/**
 * Format a dollar amount as a two-decimal string with no grouping.
 */
export function formatMoney(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Place a hold: reduce available funds, emit a stable confirmation id.
 *
 * @throws If the amount is not money, is not positive, or exceeds available
 */
export function placeHold(
  member: MemberRecord,
  share: ShareRecord,
  amountRaw: string,
  reasonRaw: string,
): HoldQuote {
  const amount = parseMoney(amountRaw);
  if (amount === undefined) {
    throw new InvalidHoldAmountError(amountRaw);
  }
  if (amount <= 0) {
    throw new InvalidHoldAmountError(amountRaw);
  }
  if (amount > share.availableBalance) {
    throw new HoldExceedsAvailableError(share.availableBalance);
  }
  const reason = reasonRaw.trim();
  if (reason.length === 0) {
    throw new HoldReasonRequiredError();
  }
  const cents = Math.round(amount * 100);
  const holdConfirmationId = `HLD-${member.memberId}-${share.shareId}-${String(cents)}`;
  return {
    memberId: member.memberId,
    shareId: share.shareId,
    holdAmount: formatMoney(amount),
    availableAfter: formatMoney(roundMoney(share.availableBalance - amount)),
    holdConfirmationId,
    holdExpires: addCalendarDays(SYSTEM_DATE, HOLD_TERM_DAYS),
    reason,
    processingDate: SYSTEM_DATE,
  };
}

export class InvalidHoldAmountError extends Error {
  constructor(readonly raw: string) {
    super("Hold amount is not a valid dollar amount");
    this.name = "InvalidHoldAmountError";
  }
}

export class HoldExceedsAvailableError extends Error {
  constructor(readonly available: number) {
    super(`Hold exceeds available ${formatMoney(available)}`);
    this.name = "HoldExceedsAvailableError";
  }
}

export class HoldReasonRequiredError extends Error {
  constructor() {
    super("Hold reason is required");
    this.name = "HoldReasonRequiredError";
  }
}

function parseMoney(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!MONEY.test(trimmed)) {
    return undefined;
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  return roundMoney(amount);
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function addCalendarDays(iso: string, days: number): string {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new Error(`expected ISO date, got ${iso}`);
  }
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  );
  const d = new Date(utc);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${String(d.getUTCFullYear())}-${mm}-${dd}`;
}
