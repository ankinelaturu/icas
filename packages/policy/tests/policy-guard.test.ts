import { describe, expect, it } from "vitest";

import { PolicyGuard } from "../src/policy-guard.js";
import type { RuntimePolicy } from "../src/policy-types.js";

const policy: RuntimePolicy = {
  allowedOrigins: ["https://bank.example"],
  allowedActionTypes: ["click", "fill"],
};

describe("PolicyGuard action allowlist", () => {
  const guard = new PolicyGuard(policy);

  it("allows click and fill when listed", () => {
    expect(
      guard.check({
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Search" }] },
      }),
    ).toEqual({ decision: "allow" });
    expect(
      guard.check({
        type: "fill",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { literal: "1" },
      }),
    ).toEqual({ decision: "allow" });
  });

  it("denies a disallowed action type", () => {
    expect(
      guard.check({
        type: "navigate",
        path: "/admin",
      }),
    ).toEqual({
      decision: "deny",
      reason: "Action type navigate is not allowed.",
    });
  });

  it("denies handoff when it is not on the allowlist", () => {
    expect(
      guard.check({ type: "handoff", reason: "stuck" }),
    ).toMatchObject({ decision: "deny" });
  });
});

describe("PolicyGuard origin checks", () => {
  const guard = new PolicyGuard({
    allowedOrigins: ["https://bank.example"],
    allowedActionTypes: ["click", "navigate"],
  });
  const click = {
    type: "click" as const,
    target: { strategies: [{ type: "visibleText" as const, text: "Open" }] },
  };

  it("allows an in-origin destination before execute", () => {
    expect(
      guard.check(click, {
        destinationUrl: "https://bank.example/loans/payoff",
      }),
    ).toEqual({ decision: "allow" });
  });

  it("denies an off-origin destination before execute", () => {
    expect(
      guard.check(click, { destinationUrl: "https://evil.example/phish" }),
    ).toEqual({
      decision: "deny",
      reason: "Origin https://evil.example is not allowed.",
    });
  });

  it("denies a resulting navigation that leaves allowedOrigins", () => {
    expect(
      guard.check(click, {
        destinationUrl: "https://bank.example/loans",
        resultingUrl: "https://other.example/out",
      }),
    ).toEqual({
      decision: "deny",
      reason: "Origin https://other.example is not allowed.",
    });
  });
});

describe("PolicyGuard risky actions", () => {
  const guard = new PolicyGuard({
    allowedOrigins: ["https://bank.example"],
    allowedActionTypes: ["click", "fill"],
  });

  it("requires a human for risk: risky", () => {
    expect(
      guard.check({
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Continue" }] },
        risk: "risky",
      }),
    ).toEqual({
      decision: "require-human",
      reason: "Risky action requires human approval.",
    });
  });

  it("denies transfer/payment-like control text even when the model marks it safe", () => {
    expect(
      guard.check({
        type: "click",
        target: { strategies: [{ type: "roleText", role: "button", text: "Transfer Funds" }] },
        intent: "Move money to another account",
        risk: "safe",
      }),
    ).toMatchObject({ decision: "deny", reason: /Dangerous control text/ });
    expect(
      guard.check({
        type: "click",
        target: { strategies: [{ type: "visibleText", text: "Make a Payment" }] },
      }),
    ).toMatchObject({ decision: "deny" });
  });
});
