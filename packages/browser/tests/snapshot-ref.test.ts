/**
 * @file parseAriaRoot reads role and accessible name from a node snapshot.
 */

import { describe, expect, it } from "vitest";

import { parseAriaRoot } from "../src/snapshot-ref.js";

describe("parseAriaRoot", () => {
  it("reads a concatenated link accessible name", () => {
    expect(
      parseAriaRoot(
        `- link "Share Holds Place a hold on available funds":\n  - /url: /holds.htm`,
      ),
    ).toEqual({
      role: "link",
      name: "Share Holds Place a hold on available funds",
    });
  });

  it("reads a button with no children", () => {
    expect(parseAriaRoot(`- button "Lending"`)).toEqual({
      role: "button",
      name: "Lending",
    });
  });

  it("allows a node with no quoted name", () => {
    expect(parseAriaRoot("- generic [active]:")).toEqual({
      role: "generic",
      name: undefined,
    });
  });
});
