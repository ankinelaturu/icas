/**
 * @file Tests for deterministic helix-cu hold math.
 */

import { describe, expect, it } from "vitest";

import {
  getMember,
  getShare,
  HOLD_TERM_DAYS,
  HoldExceedsAvailableError,
  HoldReasonRequiredError,
  InvalidHoldAmountError,
  placeHold,
  SYSTEM_DATE,
} from "../src/members.js";

describe("getMember", () => {
  it("returns the known demo member", () => {
    expect(getMember("441122")?.shortName).toBe("HALE, J");
  });

  it("returns undefined for an unknown id", () => {
    expect(getMember("000000")).toBeUndefined();
  });
});

describe("placeHold", () => {
  it("quotes 250.00 against share 01 of 441122", () => {
    const found = getShare("441122", "01");
    expect(found).toBeDefined();
    const quote = placeHold(
      found!.member,
      found!.share,
      "250.00",
      "pending debit card authorization",
    );
    expect(quote.holdAmount).toBe("250.00");
    expect(quote.availableAfter).toBe("1590.50");
    expect(quote.holdConfirmationId).toBe("HLD-441122-01-25000");
    expect(quote.holdExpires).toBe("2026-09-10");
    expect(quote.processingDate).toBe(SYSTEM_DATE);
    expect(HOLD_TERM_DAYS).toBe(7);
  });

  it("rejects a hold larger than available", () => {
    const found = getShare("441122", "01");
    expect(found).toBeDefined();
    expect(() =>
      placeHold(found!.member, found!.share, "99999.00", "test"),
    ).toThrow(HoldExceedsAvailableError);
  });

  it("rejects a blank reason", () => {
    const found = getShare("441122", "01");
    expect(found).toBeDefined();
    expect(() => placeHold(found!.member, found!.share, "10.00", "  ")).toThrow(
      HoldReasonRequiredError,
    );
  });

  it("rejects a non-money amount", () => {
    const found = getShare("441122", "01");
    expect(found).toBeDefined();
    expect(() => placeHold(found!.member, found!.share, "aboard", "test")).toThrow(
      InvalidHoldAmountError,
    );
  });
});
