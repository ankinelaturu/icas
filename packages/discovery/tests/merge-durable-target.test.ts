/**
 * @file mergeDurableTarget keeps the model's locators; bind CSS/label follow.
 */

import { describe, expect, it } from "vitest";

import { mergeDurableTarget } from "../src/merge-durable-target.js";

describe("mergeDurableTarget", () => {
  it("keeps the proposed phrase and drops live-node roleText", () => {
    const merged = mergeDurableTarget(
      {
        type: "click",
        target: {
          strategies: [{ type: "visibleText", text: "Primary Share" }],
        },
      },
      {
        strategies: [
          {
            type: "roleText",
            role: "link",
            text: "Primary Share Share 01 Avail 1840.50",
          },
          { type: "visibleText", text: "Primary Share Share 01 Avail 1840.50" },
        ],
      },
    );
    expect(merged).toEqual({
      type: "click",
      target: {
        strategies: [{ type: "visibleText", text: "Primary Share" }],
      },
    });
  });

  it("appends bind CSS after the model's locators", () => {
    const merged = mergeDurableTarget(
      {
        type: "fill",
        value: { literal: "441122" },
        target: {
          strategies: [{ type: "relative", text: "Member #" }],
        },
      },
      {
        strategies: [{ type: "css", selector: 'input[name="txtMember"]' }],
      },
    );
    expect(merged).toEqual({
      type: "fill",
      value: { literal: "441122" },
      target: {
        strategies: [
          { type: "relative", text: "Member #" },
          { type: "css", selector: 'input[name="txtMember"]' },
        ],
      },
    });
  });

  it("leaves navigate unchanged", () => {
    const action = { type: "navigate" as const, path: "/holds.htm" };
    expect(mergeDurableTarget(action, { strategies: [{ type: "css", selector: "#x" }] })).toBe(
      action,
    );
  });
});
