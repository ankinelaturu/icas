import type { EvidenceEvent, EvidenceWriter } from "@icas/evidence";
import { SessionHandoffController } from "@icas/handoff";
import { PolicyGuard } from "@icas/policy";
import { describe, expect, it, vi } from "vitest";

import { ReplayEngine } from "./replay-engine.js";
import { FakeSurface } from "./test-support/fake-surface.js";
import { clickStep, testCapability } from "./test-support/test-capability.js";

describe("ReplayEngine skeleton", () => {
  it("returns success for an empty-steps capability without touching the surface", async () => {
    const surface = new FakeSurface();
    const engine = new ReplayEngine(surface);
    const result = await engine.run(testCapability({ steps: [] }), {}, {
      runId: "run-empty",
    });
    expect(result).toEqual({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: {},
      runId: "run-empty",
    });
    expect(surface.executed).toEqual([]);
    expect(surface.asserted).toEqual([
      { type: "textVisible", value: "Payoff Statement" },
    ]);
  });

  it("returns a structured failure when the capability is missing", async () => {
    const engine = new ReplayEngine(new FakeSurface());
    const result = await engine.run(undefined, {}, { runId: "run-missing" });
    expect(result).toEqual({
      status: "failure",
      capabilityId: "unknown",
      code: "MISSING_CAPABILITY",
      runId: "run-missing",
    });
  });
});

describe("ReplayEngine preconditions", () => {
  it("passes through when the first step's preconditions hold", async () => {
    const surface = new FakeSurface();
    const engine = new ReplayEngine(surface);
    const pre = { type: "textVisible" as const, value: "Home" };
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", { preconditions: [pre] }),
          clickStep("open-search"),
        ],
      }),
      {},
      { runId: "run-pre-ok" },
    );
    expect(result.status).toBe("success");
    expect(surface.asserted).toEqual([
      pre,
      { type: "textVisible", value: "Payoff Statement" },
    ]);
    expect(surface.executed).toHaveLength(2);
  });

  it("fails PRECONDITION_FAILED on the first mismatched step and skips later steps", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
    const engine = new ReplayEngine(surface);
    const expected = { type: "textVisible" as const, value: "Home" };
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", { preconditions: [expected] }),
          clickStep("open-search", {
            preconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
        ],
      }),
      {},
      { runId: "run-pre-fail" },
    );
    expect(result).toEqual({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "PRECONDITION_FAILED",
      stepId: "open-lending",
      expected,
      observed: false,
      runId: "run-pre-fail",
    });
    expect(surface.asserted[0]).toEqual(expected);
    expect(surface.executed).toEqual([]);
    expect(
      surface.asserted.some(
        (assertion) =>
          assertion.type === "textVisible" && assertion.value === "Lending Services",
      ),
    ).toBe(false);
  });
});

describe("ReplayEngine policy gate", () => {
  it("executes an allowed click and never executes a denied navigate", async () => {
    const surface = new FakeSurface();
    const policy = new PolicyGuard({
      allowedOrigins: ["https://bank.example"],
      allowedActionTypes: ["click", "fill"],
    });
    const engine = new ReplayEngine(surface, { policy });
    const allowed = await engine.run(
      testCapability({ steps: [clickStep("open-lending")] }),
      {},
      { runId: "run-policy-allow" },
    );
    expect(allowed.status).toBe("success");
    expect(surface.executed).toHaveLength(1);
    expect(surface.executed[0]?.type).toBe("click");

    surface.executed.length = 0;
    const denied = await engine.run(
      testCapability({
        steps: [
          {
            id: "go-admin",
            preconditions: [],
            action: { type: "navigate", path: "/admin" },
            postconditions: [],
          },
        ],
      }),
      {},
      { runId: "run-policy-deny" },
    );
    expect(denied).toMatchObject({
      status: "failure",
      code: "POLICY_BLOCKED",
      stepId: "go-admin",
      runId: "run-policy-deny",
    });
    expect(surface.executed).toEqual([]);
  });
});

describe("ReplayEngine execute and postconditions", () => {
  it("succeeds when the action runs and postconditions hold", async () => {
    const surface = new FakeSurface();
    const post = { type: "textVisible" as const, value: "Lending Services" };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending", { postconditions: [post] })],
      }),
      {},
      { runId: "run-post-ok" },
    );
    expect(result.status).toBe("success");
    expect(surface.executed).toHaveLength(1);
    expect(surface.asserted).toEqual([
      post,
      { type: "textVisible", value: "Payoff Statement" },
    ]);
  });

  it("fails POSTCONDITION_FAILED when the page does not match after execute", async () => {
    const surface = new FakeSurface();
    const post = { type: "textVisible" as const, value: "Lending Services" };
    surface.assertHandler = () => false;
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending", { postconditions: [post] })],
      }),
      {},
      { runId: "run-post-fail" },
    );
    expect(result).toEqual({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "POSTCONDITION_FAILED",
      stepId: "open-lending",
      expected: post,
      observed: false,
      runId: "run-post-fail",
    });
    expect(surface.executed).toHaveLength(1);
  });

  it("fails TARGET_NOT_FOUND when execute cannot locate the control", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = () => {
      const error = new Error("no matching control");
      (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
      throw error;
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({ steps: [clickStep("open-lending")] }),
      {},
      { runId: "run-target" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "TARGET_NOT_FOUND",
      stepId: "open-lending",
      runId: "run-target",
    });
  });
});

describe("ReplayEngine success and outputs", () => {
  it("extracts typed money outputs after overall success assertions pass", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = (action) => {
      if (action.type === "read") {
        return { status: "ok", details: { value: "1234.56" } };
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending")],
        outputs: {
          totalPayoffAmount: {
            type: "money",
            extract: {
              target: {
                strategies: [{ type: "label", label: "Total Payoff Amount" }],
              },
            },
          },
        },
      }),
      {},
      { runId: "run-outputs" },
    );
    expect(result).toEqual({
      status: "success",
      capabilityId: "loan-payoff",
      outputs: { totalPayoffAmount: "1234.56" },
      runId: "run-outputs",
    });
  });

  it("fails OUTPUT_EXTRACTION_FAILED when a declared output cannot be read", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = (action) => {
      if (action.type === "read") {
        return { status: "ok", details: {} };
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("open-lending")],
        outputs: {
          totalPayoffAmount: {
            type: "money",
            extract: {
              target: {
                strategies: [{ type: "label", label: "Total Payoff Amount" }],
              },
            },
          },
        },
      }),
      {},
      { runId: "run-extract-fail" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "OUTPUT_EXTRACTION_FAILED",
      runId: "run-extract-fail",
    });
  });
});

describe("ReplayEngine business outcomes", () => {
  it("returns LOAN_NOT_FOUND as business_outcome when the page says the loan is missing", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = (assertion) =>
      assertion.type === "textVisible" && assertion.value === "Loan not found";
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("search", {
            postconditions: [{ type: "textVisible", value: "Payoff Statement" }],
          }),
        ],
      }),
      {},
      { runId: "run-loan-missing" },
    );
    expect(result).toEqual({
      status: "business_outcome",
      capabilityId: "loan-payoff",
      outcome: "LOAN_NOT_FOUND",
      details: { text: "Loan not found" },
      runId: "run-loan-missing",
    });
  });
});

function memoryEvidence(): { events: EvidenceEvent[]; evidence: EvidenceWriter } {
  const events: EvidenceEvent[] = [];
  return {
    events,
    evidence: {
      append: async (event) => {
        events.push(event);
      },
      writeSummary: async () => {},
      captureRichSignal: async () => {},
    },
  };
}

describe("ReplayEngine recoverable retries", () => {
  it("dismisses a known interstitial, logs recovery, then succeeds", async () => {
    const surface = new FakeSurface();
    let dismissed = false;
    surface.assertHandler = (assertion) => {
      if (assertion.type === "textVisible" && assertion.value === "Please wait") {
        return !dismissed;
      }
      if (assertion.type === "textVisible" && assertion.value === "Home") {
        return dismissed;
      }
      return true;
    };
    surface.executeHandler = (action) => {
      if (
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Continue",
        )
      ) {
        dismissed = true;
      }
      return { status: "ok" };
    };
    const { events, evidence } = memoryEvidence();
    const engine = new ReplayEngine(surface, { evidence });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            preconditions: [{ type: "textVisible", value: "Home" }],
          }),
        ],
      }),
      {},
      { runId: "run-interstitial" },
    );
    expect(result.status).toBe("success");
    expect(events.some((event) => event.type === "recovery")).toBe(true);
  });

  it("does not retry a semantic precondition mismatch", async () => {
    const surface = new FakeSurface();
    let homeChecks = 0;
    surface.assertHandler = (assertion) => {
      if (assertion.type === "textVisible" && assertion.value === "Home") {
        homeChecks += 1;
        return false;
      }
      return false;
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            preconditions: [{ type: "textVisible", value: "Home" }],
          }),
        ],
      }),
      {},
      { runId: "run-semantic", maxRetries: 50 },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "PRECONDITION_FAILED",
      stepId: "open-lending",
    });
    expect(homeChecks).toBe(1);
  });
});

describe("ReplayEngine hard failures and evidence", () => {
  it("fails UNEXPECTED_STATE when overall success assertions do not hold", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = (assertion) =>
      !(assertion.type === "textVisible" && assertion.value === "Payoff Statement");
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({ steps: [clickStep("open-lending")] }),
      {},
      { runId: "run-success-miss" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "UNEXPECTED_STATE",
      expected: { type: "textVisible", value: "Payoff Statement" },
      observed: false,
      runId: "run-success-miss",
    });
  });

  it("captures rich evidence at the failure boundary for each hard-failure code", async () => {
    const cases: Array<{
      code: string;
      run: (surface: FakeSurface, engine: ReplayEngine) => Promise<unknown>;
    }> = [
      {
        code: "PRECONDITION_FAILED",
        run: async (surface, engine) => {
          surface.assertHandler = () => false;
          return engine.run(
            testCapability({
              steps: [
                clickStep("open-lending", {
                  preconditions: [{ type: "textVisible", value: "Home" }],
                }),
              ],
            }),
            {},
            { runId: "ev-pre" },
          );
        },
      },
      {
        code: "POLICY_BLOCKED",
        run: async (surface, engine) =>
          engine.run(
            testCapability({
              steps: [
                {
                  id: "go-admin",
                  preconditions: [],
                  action: { type: "navigate", path: "/admin" },
                  postconditions: [],
                },
              ],
            }),
            {},
            { runId: "ev-policy" },
          ),
      },
      {
        code: "TARGET_NOT_FOUND",
        run: async (surface, engine) => {
          surface.executeHandler = () => {
            const error = new Error("missing");
            (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
            throw error;
          };
          return engine.run(
            testCapability({ steps: [clickStep("open-lending")] }),
            {},
            { runId: "ev-target" },
          );
        },
      },
      {
        code: "POSTCONDITION_FAILED",
        run: async (surface, engine) => {
          surface.assertHandler = () => false;
          return engine.run(
            testCapability({
              steps: [
                clickStep("open-lending", {
                  postconditions: [{ type: "textVisible", value: "Lending Services" }],
                }),
              ],
            }),
            {},
            { runId: "ev-post" },
          );
        },
      },
      {
        code: "UNEXPECTED_STATE",
        run: async (surface, engine) => {
          surface.assertHandler = (assertion) =>
            !(assertion.type === "textVisible" && assertion.value === "Payoff Statement");
          return engine.run(
            testCapability({ steps: [clickStep("open-lending")] }),
            {},
            { runId: "ev-unexpected" },
          );
        },
      },
      {
        code: "OUTPUT_EXTRACTION_FAILED",
        run: async (surface, engine) => {
          surface.executeHandler = (action) =>
            action.type === "read"
              ? { status: "ok", details: {} }
              : { status: "ok" };
          return engine.run(
            testCapability({
              steps: [clickStep("open-lending")],
              outputs: {
                totalPayoffAmount: {
                  type: "money",
                  extract: {
                    target: {
                      strategies: [{ type: "label", label: "Total Payoff Amount" }],
                    },
                  },
                },
              },
            }),
            {},
            { runId: "ev-output" },
          );
        },
      },
    ];

    for (const testCase of cases) {
      const surface = new FakeSurface();
      const { events, evidence } = memoryEvidence();
      const signals: Array<{ kind: string; value: unknown }> = [];
      const capturing: EvidenceWriter = {
        ...evidence,
        captureRichSignal: async (kind, value) => {
          signals.push({ kind, value });
        },
      };
      const policy = new PolicyGuard({
        allowedOrigins: ["https://bank.example"],
        allowedActionTypes: ["click", "fill", "read"],
      });
      const engine = new ReplayEngine(surface, { policy, evidence: capturing });
      const result = (await testCase.run(surface, engine)) as {
        status: string;
        code?: string;
        stepId?: string;
        expected?: unknown;
        observed?: unknown;
      };
      expect(result.status).toBe("failure");
      expect(result.code).toBe(testCase.code);
      expect(result).toHaveProperty("expected");
      expect(result).toHaveProperty("observed");
      expect(events.some((event) => event.type === "failure")).toBe(true);
      expect(signals.some((signal) => signal.kind === "screenshot")).toBe(true);
    }
  });
});

describe("ReplayEngine assisted fallback repair", () => {
  const policy = new PolicyGuard({
    allowedOrigins: ["https://bank.example"],
    allowedActionTypes: ["click", "fill", "read"],
  });

  it("does not execute a policy-blocked repair action", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
    const engine = new ReplayEngine(surface, {
      policy,
      repair: {
        propose: async () => ({
          actions: [{ type: "navigate", path: "/invented" }],
          rationale: "try another page",
        }),
      },
    });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            postconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
        ],
      }),
      {},
      { runId: "run-assist-deny", assist: true },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "POLICY_BLOCKED",
      runId: "run-assist-deny",
    });
    expect(surface.executed.some((action) => action.type === "navigate")).toBe(false);
  });

  it("stops when the repair proposal exceeds the assist budget", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
    const clicks = Array.from({ length: 5 }, () => ({
      type: "click" as const,
      target: { strategies: [{ type: "visibleText" as const, text: "Next" }] },
    }));
    const engine = new ReplayEngine(surface, {
      policy,
      repair: {
        propose: async () => ({ actions: clicks, rationale: "spam clicks" }),
      },
    });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            postconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
        ],
      }),
      {},
      { runId: "run-assist-budget", assist: true, assistBudget: 2 },
    );
    expect(result).toMatchObject({
      status: "failure",
      observed: "assist budget exceeded",
      runId: "run-assist-budget",
    });
    const repairClicks = surface.executed.filter(
      (action) =>
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Next",
        ),
    );
    expect(repairClicks).toHaveLength(2);
  });
});

describe("ReplayEngine assisted fallback rejoin", () => {
  const policy = new PolicyGuard({
    allowedOrigins: ["https://bank.example"],
    allowedActionTypes: ["click", "fill", "read"],
  });

  it("rejoins the deterministic path after postconditions and next preconditions pass", async () => {
    const surface = new FakeSurface();
    let repaired = false;
    surface.assertHandler = (assertion) => {
      if (assertion.type === "textVisible" && assertion.value === "Lending Services") {
        return repaired;
      }
      if (assertion.type === "textVisible" && assertion.value === "Search ready") {
        return repaired;
      }
      return assertion.type === "textVisible" && assertion.value === "Payoff Statement";
    };
    surface.executeHandler = (action) => {
      if (
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Retry",
        )
      ) {
        repaired = true;
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface, {
      policy,
      repair: {
        propose: async () => ({
          actions: [
            {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Retry" }] },
            },
          ],
          rationale: "click retry",
        }),
      },
    });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            postconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
          clickStep("open-search", {
            preconditions: [{ type: "textVisible", value: "Search ready" }],
          }),
        ],
      }),
      {},
      { runId: "run-rejoin-ok", assist: true },
    );
    expect(result.status).toBe("success");
    expect(
      surface.executed.filter((action) => action.type === "click"),
    ).toHaveLength(3);
  });

  it("stops on a failed rejoin and does not invent further steps", async () => {
    const surface = new FakeSurface();
    let repaired = false;
    let proposals = 0;
    surface.assertHandler = (assertion) => {
      if (assertion.type === "textVisible" && assertion.value === "Lending Services") {
        return repaired;
      }
      if (assertion.type === "textVisible" && assertion.value === "Search ready") {
        return false;
      }
      return assertion.type === "textVisible" && assertion.value === "Payoff Statement";
    };
    surface.executeHandler = (action) => {
      if (
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Retry",
        )
      ) {
        repaired = true;
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface, {
      policy,
      repair: {
        propose: async () => {
          proposals += 1;
          return {
            actions: [
              {
                type: "click",
                target: { strategies: [{ type: "visibleText", text: "Retry" }] },
              },
            ],
            rationale: "click retry",
          };
        },
      },
    });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            postconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
          clickStep("open-search", {
            preconditions: [{ type: "textVisible", value: "Search ready" }],
          }),
          clickStep("open-payoff"),
        ],
      }),
      {},
      { runId: "run-rejoin-fail", assist: true },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "PRECONDITION_FAILED",
      stepId: "open-search",
    });
    expect(proposals).toBe(1);
    const continueClicks = surface.executed.filter(
      (action) =>
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Continue",
        ),
    );
    expect(continueClicks).toHaveLength(1);
  });
});



describe("ReplayEngine HITL", () => {
  it("pauses a risky encoded action and continues the same step after resume", async () => {
    const surface = new FakeSurface();
    const handoff = new SessionHandoffController();
    const policy = new PolicyGuard({
      allowedOrigins: ["https://bank.example"],
      allowedActionTypes: ["click", "fill", "read"],
    });
    const engine = new ReplayEngine(surface, { policy, handoff });
    const pending = engine.run(
      testCapability({
        steps: [
          clickStep("confirm", {
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Continue" }] },
              risk: "risky",
            },
          }),
        ],
      }),
      {},
      { runId: "run-hitl" },
    );
    await vi.waitFor(() => {
      expect(handoff.owner()).toBe("human");
    });
    expect(surface.executed).toEqual([]);
    expect(surface.humanTakes).toBe(1);
    handoff.signalResume();
    const result = await pending;
    expect(result.status).toBe("success");
    expect(handoff.owner()).toBe("automation");
    expect(surface.automationResumes).toBe(1);
    expect(surface.executed).toHaveLength(1);
  });
});

