/**
 * @file mergeDurableTarget puts live-node locators ahead of the model's guess.
 */

import { describe, expect, it } from "vitest";

import { mergeDurableTarget } from "../src/merge-durable-target.js";

describe("mergeDurableTarget", () => {
  it("puts durable roleText first and keeps the proposed visibleText", () => {
    const merged = mergeDurableTarget(
      {
        type: "click",
        target: {
          strategies: [
            {
              type: "visibleText",
              text: "Share Holds Place a hold on available funds",
            },
          ],
        },
      },
      {
        strategies: [
          {
            type: "roleText",
            role: "link",
            text: "Share Holds Place a hold on available funds",
          },
        ],
      },
    );
    expect(merged).toEqual({
      type: "click",
      target: {
        strategies: [
          {
            type: "roleText",
            role: "link",
            text: "Share Holds Place a hold on available funds",
          },
          {
            type: "visibleText",
            text: "Share Holds Place a hold on available funds",
          },
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
