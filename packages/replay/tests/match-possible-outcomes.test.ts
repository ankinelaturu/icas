/**
 * @file matchPossibleOutcomes — OR phrases, skip success, first hit wins.
 */

import { describe, expect, it } from "vitest";

import { matchPossibleOutcomes, outcomeSlug } from "../src/match-possible-outcomes.js";
import { FakeSurface } from "./test-support/fake-surface.js";

describe("matchPossibleOutcomes", () => {
  it("hits when any phrase is visible and skips success entries", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = (assertion) =>
      assertion.type === "textVisible" && assertion.value === "Loan not found";
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

  it("returns undefined when nothing matches", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
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

describe("outcomeSlug", () => {
  it("slugs heading copy instead of a product enum", () => {
    expect(outcomeSlug("Loan not found", "Loan not found")).toBe("loan_not_found");
  });
});
