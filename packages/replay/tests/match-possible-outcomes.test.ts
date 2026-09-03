/**
 * @file matchPossibleOutcomes — OR phrases, skip success, first hit wins.
 *
 * Also covers the ordered matcher pipeline: substring, then embedding stub.
 */

import { describe, expect, it } from "vitest";

import { matchPossibleOutcomes, outcomeSlug, pageTextContainsPhrase } from "../src/match-possible-outcomes.js";
import { DEFAULT_OUTCOME_MATCHERS } from "../src/default-outcome-matchers.js";
import { EmbeddingOutcomeMatcher } from "../src/embedding-outcome-matcher.js";
import { runOutcomeMatchers, type OutcomeMatcher } from "../src/outcome-matcher.js";
import { SubstringOutcomeMatcher } from "../src/substring-outcome-matcher.js";
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

const lookupMiss = {
  kind: "error" as const,
  match: { phrases: ["Loan not found"] },
  heading: "Loan not found",
  summary: null,
};

describe("outcome matcher pipeline", () => {
  it("registers substring before the embedding stub", () => {
    expect(DEFAULT_OUTCOME_MATCHERS.map((matcher) => matcher.id)).toEqual([
      "substring",
      "embedding",
    ]);
  });

  it("embedding stub never matches", () => {
    const hit = new EmbeddingOutcomeMatcher().match(
      { pageText: "No loan record found for LN Acct # 909090." },
      [lookupMiss],
    );
    expect(hit).toBeUndefined();
  });

  it("runs the next matcher when substring misses", () => {
    const order: string[] = [];
    const later: OutcomeMatcher = {
      id: "later",
      match(_context, outcomes) {
        order.push("later");
        const outcome = outcomes[0];
        if (outcome === undefined) {
          return undefined;
        }
        return { outcome, phrase: "semantic-hit" };
      },
    };
    const miss: OutcomeMatcher = {
      id: "miss",
      match() {
        order.push("miss");
        return undefined;
      },
    };
    const hit = runOutcomeMatchers([miss, later], { pageText: "unrelated chrome" }, [
      lookupMiss,
    ]);
    expect(order).toEqual(["miss", "later"]);
    expect(hit?.phrase).toBe("semantic-hit");
  });

  it("does not call later matchers after a substring hit", async () => {
    let laterCalls = 0;
    const later: OutcomeMatcher = {
      id: "later",
      match() {
        laterCalls += 1;
        return undefined;
      },
    };
    const surface = new FakeSurface();
    surface.visibleTextContent = "Loan not found on this banner.";
    const hit = await matchPossibleOutcomes(surface, [lookupMiss], [
      new SubstringOutcomeMatcher(),
      later,
    ]);
    expect(hit?.phrase).toBe("Loan not found");
    expect(laterCalls).toBe(0);
  });

  it("falls through the embedding stub when substring misses", async () => {
    const surface = new FakeSurface();
    surface.visibleTextContent = "No loan record found for LN Acct # 909090.";
    const hit = await matchPossibleOutcomes(surface, [lookupMiss]);
    expect(hit).toBeUndefined();
  });
});
