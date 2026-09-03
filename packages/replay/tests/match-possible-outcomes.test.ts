/**
 * @file matchPossibleOutcomes — OR phrases, skip success, first hit wins.
 */

import { describe, expect, it } from "vitest";

import { matchPossibleOutcomes, outcomeSlug, pageTextContainsPhrase } from "../src/match-possible-outcomes.js";
import { FakeSurface } from "./test-support/fake-surface.js";

describe("matchPossibleOutcomes", () => {
  it("hits when any phrase is visible and skips success entries", async () => {
    const surface = new FakeSurface();
    surface.visibleTextContent = "Inquiry failed: Loan not found for that account.";
    const hit = await matchPossibleOutcomes(surface, [
      {
        kind: "success",
        match: { phrases: ["Loan Details"] },
        heading: null,
        summary: null,
      },
      {
        kind: "error",
        match: { phrases: ["No matching account", "Loan not found"] },
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
      },
    ]);
    expect(hit?.phrase).toBe("Loan not found");
    expect(hit?.outcome.kind).toBe("error");
  });

  it("reads visibleText once and does not assert", async () => {
    const surface = new FakeSurface();
    surface.visibleTextContent = "Call member services";
    surface.assertHandler = () => {
      throw new Error("possibleOutcomes must not wait via assert");
    };
    const hit = await matchPossibleOutcomes(surface, [
      {
        kind: "hitl",
        match: { phrases: ["Call member services"] },
        heading: "Need assistance",
        summary: null,
      },
    ]);
    expect(hit?.phrase).toBe("Call member services");
    expect(surface.asserted).toEqual([]);
  });

  it("returns undefined when nothing matches", async () => {
    const surface = new FakeSurface();
    surface.visibleTextContent = "Search Loan Account";
    const hit = await matchPossibleOutcomes(surface, [
      {
        kind: "error",
        match: { phrases: ["Loan not found"] },
        heading: "Loan not found",
        summary: null,
      },
    ]);
    expect(hit).toBeUndefined();
  });
});

describe("pageTextContainsPhrase", () => {
  it("matches a case-insensitive substring", () => {
    expect(
      pageTextContainsPhrase("No loan record found for LN Acct # 909090.", "no loan record found"),
    ).toBe(true);
    expect(pageTextContainsPhrase("Ready.", "Loan not found")).toBe(false);
  });
});

describe("outcomeSlug", () => {
  it("slugs heading copy instead of a product enum", () => {
    expect(outcomeSlug("Loan not found", "Loan not found")).toBe("loan_not_found");
  });
});
