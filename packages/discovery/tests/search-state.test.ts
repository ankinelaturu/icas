/**
 * @file Tests for SearchNode shape and numeric budget coercion.
 */

import { describe, expect, it } from "vitest";

import {
  createSearchNode,
  DEFAULT_SEARCH_BUDGET,
  resolveSearchBudget,
  stateIdFromObservation,
} from "../src/search-state.js";

describe("resolveSearchBudget", () => {
  it("exposes numeric default limits", () => {
    const budget = resolveSearchBudget();
    expect(budget).toEqual(DEFAULT_SEARCH_BUDGET);
    expect(typeof budget.maxSteps).toBe("number");
    expect(typeof budget.maxDepth).toBe("number");
    expect(typeof budget.maxCandidatesPerState).toBe("number");
    expect(typeof budget.timeoutMs).toBe("number");
  });

  it("applies request overrides as positive integers", () => {
    const budget = resolveSearchBudget({
      maxSteps: 3.9,
      maxDepth: 2,
      maxCandidatesPerState: 4,
      timeoutMs: 50,
    });
    expect(budget.maxSteps).toBe(3);
    expect(budget.maxDepth).toBe(2);
    expect(budget.maxCandidatesPerState).toBe(4);
    expect(budget.timeoutMs).toBe(50);
  });

  it("ignores non-positive values so later passes can enforce real limits", () => {
    const budget = resolveSearchBudget({
      maxSteps: 0,
      maxDepth: -1,
      timeoutMs: Number.NaN,
    });
    expect(budget.maxSteps).toBe(DEFAULT_SEARCH_BUDGET.maxSteps);
    expect(budget.maxDepth).toBe(DEFAULT_SEARCH_BUDGET.maxDepth);
    expect(budget.timeoutMs).toBe(DEFAULT_SEARCH_BUDGET.timeoutMs);
  });
});

describe("createSearchNode", () => {
  it("sets stateId, depth, and an empty tried set", () => {
    const root = createSearchNode({
      observation: { id: "obs-home", url: "http://localhost/home" },
    });
    const child = createSearchNode({
      observation: { id: "obs-lend", url: "http://localhost/lending" },
      parent: root,
    });
    expect(root.depth).toBe(0);
    expect(root.triedCandidateIds.size).toBe(0);
    expect(root.parent).toBeUndefined();
    expect(child.depth).toBe(1);
    expect(child.parent).toBe(root);
    expect(stateIdFromObservation(root.observation)).toBe("http://localhost/home");
    expect(
      stateIdFromObservation({
        id: "obs-a",
        url: "http://localhost/search",
        accessibilitySnapshot: "textbox empty",
      }),
    ).not.toBe(
      stateIdFromObservation({
        id: "obs-b",
        url: "http://localhost/search",
        accessibilitySnapshot: "textbox 987654",
      }),
    );
  });
});
