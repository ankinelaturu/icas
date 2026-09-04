/**
 * @file durableSuccessSignals keeps headings, not this-run dates/ids/amounts.
 */

import { describe, expect, it } from "vitest";

import { durableSuccessSignals } from "../src/derive-artifact.js";
import type { SuccessfulPathStep } from "../src/extract-successful-path.js";

const fillMember: SuccessfulPathStep = {
  action: {
    type: "fill",
    target: { strategies: [{ type: "relative", text: "Member #" }] },
    value: { literal: "441122" },
    risk: "safe",
  },
  proposedInputParam: { name: "memberNumber", type: "string", required: true },
};

const fillAmount: SuccessfulPathStep = {
  action: {
    type: "fill",
    target: { strategies: [{ type: "relative", text: "Hold Amt" }] },
    value: { literal: "250.00" },
    risk: "safe",
  },
  proposedInputParam: { name: "holdAmount", type: "money", required: true },
  after: { id: "confirm", url: "http://localhost:4103/holds/confirm.htm" },
};

describe("durableSuccessSignals", () => {
  it("keeps the heading when a confirmation id embeds member and amount", () => {
    const success = durableSuccessSignals(
      [
        {
          type: "textVisible",
          value: "Hold Confirmation: HLD-441122-01-25000 placed successfully.",
        },
      ],
      [fillMember, fillAmount],
    );
    expect(success).toEqual([{ type: "textVisible", value: "Hold Confirmation" }]);
  });

  it("keeps the heading when a lead line includes a processing date", () => {
    const success = durableSuccessSignals(
      [
        {
          type: "textVisible",
          value: "SHARE HOLD PLACED · As of processing date 2026-09-03.",
        },
      ],
      [fillMember, fillAmount],
    );
    expect(success).toEqual([{ type: "textVisible", value: "SHARE HOLD PLACED" }]);
  });

  it("leaves a stable sentence that has no date, amount, or id", () => {
    const success = durableSuccessSignals(
      [
        {
          type: "textVisible",
          value:
            "Payoff Statement is ready. Figures are good-faith through the stated payoff date.",
        },
      ],
      [
        {
          action: {
            type: "fill",
            target: { strategies: [{ type: "relative", text: "LN Acct #" }] },
            value: { literal: "987654" },
            risk: "safe",
          },
          proposedInputParam: { name: "loanAccountNumber", type: "string", required: true },
        },
      ],
    );
    expect(success).toEqual([
      {
        type: "textVisible",
        value:
          "Payoff Statement is ready. Figures are good-faith through the stated payoff date.",
      },
    ]);
  });

  it("falls back to the last URL when the whole string is instance data", () => {
    const success = durableSuccessSignals(
      [{ type: "textVisible", value: "HLD-441122-01-25000" }],
      [fillMember, fillAmount],
    );
    expect(success).toEqual([{ type: "urlMatches", pattern: "/holds/confirm.htm" }]);
  });
});
