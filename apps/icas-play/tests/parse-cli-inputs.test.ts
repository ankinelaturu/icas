/**
 * @file CLI input flag parsing is independent of Commander.
 */

import { describe, expect, it } from "vitest";

import { parseCapabilityInputFlags } from "../src/parse-cli-inputs.js";

describe("parseCapabilityInputFlags", () => {
  it("reads --name value and --input name=value", () => {
    expect(
      parseCapabilityInputFlags([
        "--loanAccountId",
        "987654",
        "--input",
        "payoffDate=2026-09-30",
      ]),
    ).toEqual({
      loanAccountId: "987654",
      payoffDate: "2026-09-30",
    });
  });

  it("ignores reserved identity flags so --url cannot become an input", () => {
    expect(
      parseCapabilityInputFlags(["--url", "https://bank.example", "--loanAccountId", "1"]),
    ).toEqual({ loanAccountId: "1" });
  });

  it("rejects --input without name=value", () => {
    expect(() => parseCapabilityInputFlags(["--input", "loanAccountId"])).toThrow(
      /name=value/,
    );
  });
});
