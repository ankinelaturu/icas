import {
  DETERMINISTIC_ACTION_EVENT,
  type EvidenceEvent,
  type EvidenceWriter,
  type RunSummary,
} from "@icas/evidence";
import { SessionHandoffController } from "@icas/handoff";
import { PolicyGuard } from "@icas/policy";
import { describe, expect, it, vi } from "vitest";

import { ReplayEngine } from "../src/replay-engine.js";
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

describe("ReplayEngine possibleOutcomes", () => {
  const loanNotFound = {
    kind: "error" as const,
    match: { phrases: ["Loan not found"] },
    heading: "Loan not found",
    summary: "No loan matches the requested account id.",
  };

  function targetMiss(): Error {
    const error = new Error("no matching control");
    (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
    return error;
  }

  function payoffStep() {
    return clickStep("open-payoff", {
      action: {
        type: "click" as const,
        target: { strategies: [{ type: "visibleText" as const, text: "Payoff" }] },
        risk: "safe" as const,
      },
    });
  }

  it("returns business_outcome when the next locator is missing and a phrase is visible", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = (target) => {
      const first = target.strategies[0];
      if (first !== undefined && "text" in first && first.text === "Payoff") {
        throw targetMiss();
      }
      return { ok: true };
    };
    surface.visibleTextContent = "Inquiry: Loan not found for that account.";
    const { events, summaries, signals, evidence } = memoryEvidence();
    const engine = new ReplayEngine(surface, { evidence });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", { possibleOutcomes: [loanNotFound] }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-loan-missing" },
    );
    expect(result).toEqual({
      status: "business_outcome",
      capabilityId: "loan-payoff",
      outcome: "loan_not_found",
      details: {
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
        message: "Loan not found",
        match: { phrases: ["Loan not found"] },
      },
      runId: "run-loan-missing",
    });
    expect(surface.executed).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["business_outcome"]),
    );
    expect(summaries[0]).toMatchObject({
      status: "business_outcome",
      runId: "run-loan-missing",
    });
    expect(signals.some((signal) => signal.kind === "screenshot")).toBe(true);
  });

  it("does not scan possibleOutcomes when the next locator is present", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => true;
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", { possibleOutcomes: [loanNotFound] }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-next-found" },
    );
    expect(result.status).toBe("success");
    expect(surface.executed).toHaveLength(2);
  });

  it("fails when the next locator is missing and no outcome matches", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = () => {
      throw targetMiss();
    };
    surface.assertHandler = () => false;
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", { possibleOutcomes: [loanNotFound] }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-no-match" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "UNEXPECTED_STATE",
      stepId: "open-payoff",
      runId: "run-no-match",
    });
    expect(surface.executed).toHaveLength(1);
  });

  it("pauses for HITL when a hitl outcome matches", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = () => {
      throw targetMiss();
    };
    surface.visibleTextContent = "Call member services to continue this inquiry.";
    const handoff = new SessionHandoffController();
    const engine = new ReplayEngine(surface, { handoff });
    const run = engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", {
            possibleOutcomes: [
              {
                kind: "hitl",
                match: { phrases: ["Call member services"] },
                heading: "Need assistance",
                summary: "A person must continue this session.",
              },
            ],
          }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-hitl-outcome" },
    );
    await vi.waitFor(() => {
      expect(handoff.owner()).toBe("human");
    });
    expect(surface.humanTakes).toBe(1);
    handoff.signalResume();
    const result = await run;
    expect(result.status).toBe("failure");
    expect(surface.automationResumes).toBe(1);
    expect(result).toMatchObject({
      observed: "next action target still missing after HITL",
    });
  });

  it("continues the next step after HITL when the locator is present on resume", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = () => {
      // Overlay hides Payoff until the human dismisses it (handoffToHuman).
      if (surface.humanTakes === 0) {
        throw targetMiss();
      }
      return { ok: true };
    };
    surface.visibleTextContent = "Call member services to continue this inquiry.";
    const handoff = new SessionHandoffController();
    const engine = new ReplayEngine(surface, { handoff });
    const run = engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", {
            possibleOutcomes: [
              {
                kind: "hitl",
                match: { phrases: ["Call member services"] },
                heading: "Need assistance",
                summary: "A person must continue this session.",
              },
            ],
          }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-hitl-resume" },
    );
    await vi.waitFor(() => {
      expect(handoff.owner()).toBe("human");
    });
    expect(surface.executed).toHaveLength(1);
    surface.visibleTextContent = "Payoff";
    handoff.signalResume();
    const result = await run;
    expect(result.status).toBe("success");
    expect(surface.executed).toHaveLength(2);
    expect(surface.automationResumes).toBe(1);
  });

  it("does not classify this step's possibleOutcomes when this step's target is missing", async () => {
    const surface = new FakeSurface();
    surface.executeHandler = () => {
      throw targetMiss();
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", { possibleOutcomes: [loanNotFound] }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-this-target" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "TARGET_NOT_FOUND",
      stepId: "inquire-loan",
    });
  });

  it("does not ship a hardcoded loan-message table", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
    for (const name of readdirSync(srcDir)) {
      if (!name.endsWith(".ts")) {
        continue;
      }
      const text = readFileSync(join(srcDir, name), "utf8");
      expect(text, name).not.toMatch(
        /LOAN_NOT_FOUND|PAYOFF_NOT_AVAILABLE|INVALID_PAYOFF_DATE|LOAN_ALREADY_PAID/,
      );
    }
  });
});

describe("ReplayEngine HTTP status and generic chrome", () => {
  function targetMiss(): Error {
    const error = new Error("no matching control");
    (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
    return error;
  }

  function payoffStep() {
    return clickStep("open-payoff", {
      action: {
        type: "click" as const,
        target: { strategies: [{ type: "visibleText" as const, text: "Payoff" }] },
        risk: "safe" as const,
      },
    });
  }

  it("fails on document 404 without scanning artifact phrases", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "obs-404", httpStatus: 404 };
    surface.locateHandler = () => {
      throw targetMiss();
    };
    let phraseChecks = 0;
    surface.assertHandler = () => {
      phraseChecks += 1;
      return false;
    };
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", {
            possibleOutcomes: [
              {
                kind: "error",
                match: { phrases: ["Loan not found"] },
                heading: "Loan not found",
                summary: "No loan matches the requested account id.",
              },
            ],
          }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-http-404" },
    );
    expect(result).toMatchObject({
      status: "failure",
      code: "UNEXPECTED_STATE",
      observed: { httpStatus: 404 },
      runId: "run-http-404",
    });
    expect(phraseChecks).toBe(0);
  });

  it("matches generic Internal Server Error chrome after possibleOutcomes miss", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = () => {
      throw targetMiss();
    };
    surface.visibleTextContent = "Internal Server Error\nThe server returned a generic error page.";
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [clickStep("inquire-loan"), payoffStep()],
      }),
      {},
      { runId: "run-generic-500" },
    );
    expect(result).toMatchObject({
      status: "business_outcome",
      outcome: "internal_server_error",
      details: {
        heading: "Internal Server Error",
        message: "Internal Server Error",
      },
      runId: "run-generic-500",
    });
  });

  it("prefers a compiled step phrase over generic chrome", async () => {
    const surface = new FakeSurface();
    surface.locateHandler = () => {
      throw targetMiss();
    };
    surface.visibleTextContent =
      "Loan not found.\nInternal Server Error is also on this host banner.";
    const engine = new ReplayEngine(surface);
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("inquire-loan", {
            possibleOutcomes: [
              {
                kind: "error",
                match: { phrases: ["Loan not found"] },
                heading: "Loan not found",
                summary: "No loan matches the requested account id.",
              },
            ],
          }),
          payoffStep(),
        ],
      }),
      {},
      { runId: "run-step-wins" },
    );
    expect(result).toMatchObject({
      status: "business_outcome",
      outcome: "loan_not_found",
      details: { message: "Loan not found" },
      runId: "run-step-wins",
    });
  });
});

function memoryEvidence(): {
  events: EvidenceEvent[];
  summaries: RunSummary[];
  signals: Array<{ kind: string; value: unknown }>;
  evidence: EvidenceWriter;
} {
  const events: EvidenceEvent[] = [];
  const summaries: RunSummary[] = [];
  const signals: Array<{ kind: string; value: unknown }> = [];
  return {
    events,
    summaries,
    signals,
    evidence: {
      append: async (event) => {
        events.push(event);
      },
      writeSummary: async (summary) => {
        summaries.push(summary);
      },
      captureRichSignal: async (kind, value) => {
        signals.push({ kind, value });
      },
    },
  };
}

describe("ReplayEngine recoverable retries", () => {
  it("dismisses a known interstitial, logs recovery, then succeeds", async () => {
    const surface = new FakeSurface();
    let dismissed = false;
    surface.visibleTextContent = "Please wait. The host is restoring your operator session.";
    surface.assertHandler = (assertion) => {
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
        surface.visibleTextContent = "";
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

  it("dismisses a 200 session-warning overlay when the next locator is missing, then continues", async () => {
    const surface = new FakeSurface();
    let dismissed = false;
    const targetMiss = (): Error => {
      const error = new Error("no matching control");
      (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
      return error;
    };
    surface.locateHandler = (target) => {
      const first = target.strategies[0];
      if (first !== undefined && "text" in first && first.text === "Payoff" && !dismissed) {
        throw targetMiss();
      }
      return { ok: true };
    };
    surface.visibleTextContent =
      "Session warning\nPlease wait. The host is restoring your operator session.";
    surface.executeHandler = (action) => {
      if (
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Continue",
        )
      ) {
        dismissed = true;
        surface.visibleTextContent = "Loan Details";
      }
      return { status: "ok" };
    };
    const { events, evidence } = memoryEvidence();
    const engine = new ReplayEngine(surface, { evidence });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("click-inquire", {
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
              risk: "safe",
            },
          }),
          clickStep("click-payoff", {
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Payoff" }] },
              risk: "safe",
            },
          }),
        ],
      }),
      {},
      { runId: "run-wait-overlay" },
    );
    expect(result.status).toBe("success");
    expect(events.some((event) => event.type === "recovery")).toBe(true);
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

describe("ReplayEngine hard failures and evidence", () => {
  it("fails UNEXPECTED_STATE when overall success assertions do not hold", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
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
          surface.assertHandler = () => false;
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

describe("ReplayEngine assist next-locator miss", () => {
  const policy = new PolicyGuard({
    allowedOrigins: ["https://bank.example"],
    allowedActionTypes: ["click", "fill", "read"],
  });

  function targetMiss(): Error {
    const error = new Error("no matching control");
    (error as Error & { code: string }).code = "TARGET_NOT_FOUND";
    return error;
  }

  const fillLoan: ReturnType<typeof clickStep> = {
    id: "fill-ln-acct",
    preconditions: [],
    action: {
      type: "fill",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
      value: { literal: "112233" },
      risk: "safe",
    },
    postconditions: [
      {
        type: "valueEquals",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { literal: "112233" },
      },
    ],
  };

  const clickInquire = clickStep("click-inquire", {
    action: {
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
      risk: "safe",
    },
    postconditions: [{ type: "textVisible", value: "Loan Details" }],
  });

  it("assists the missing click, skips re-executing Inquire, and rejoins", async () => {
    const surface = new FakeSurface();
    let onDetails = false;
    let frozenStepId: string | undefined;
    let frozenPageText: string | undefined;
    surface.visibleTextContent = "Search Loan Account\nLook Up";
    surface.locateHandler = (target) => {
      const first = target.strategies[0];
      if (first !== undefined && "text" in first && first.text === "Inquire") {
        throw targetMiss();
      }
      return { ok: true };
    };
    surface.assertHandler = (assertion) => {
      if (assertion.type === "textVisible" && assertion.value === "Loan Details") {
        return onDetails;
      }
      if (assertion.type === "textVisible" && assertion.value === "Payoff ready") {
        return onDetails;
      }
      return assertion.type === "textVisible" && assertion.value === "Payoff Statement";
    };
    surface.executeHandler = (action) => {
      if (
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Look Up",
        )
      ) {
        onDetails = true;
      }
      return { status: "ok" };
    };
    const engine = new ReplayEngine(surface, {
      policy,
      repair: {
        propose: async (context) => {
          frozenStepId = context.step.id;
          frozenPageText = context.pageText;
          return {
            actions: [
              {
                type: "click",
                target: { strategies: [{ type: "visibleText", text: "Look Up" }] },
              },
            ],
            rationale: "Inquire was renamed Look Up",
          };
        },
      },
    });
    const result = await engine.run(
      testCapability({
        steps: [
          fillLoan,
          clickInquire,
          clickStep("open-payoff", {
            preconditions: [{ type: "textVisible", value: "Payoff ready" }],
          }),
        ],
      }),
      {},
      { runId: "run-assist-next-locator", assist: true },
    );
    expect(result.status).toBe("success");
    expect(frozenStepId).toBe("click-inquire");
    expect(frozenPageText).toContain("Look Up");
    const inquireClicks = surface.executed.filter(
      (action) =>
        action.type === "click" &&
        action.target.strategies.some(
          (strategy) => strategy.type === "visibleText" && strategy.text === "Inquire",
        ),
    );
    expect(inquireClicks).toHaveLength(0);
    expect(
      surface.executed.filter(
        (action) =>
          action.type === "click" &&
          action.target.strategies.some(
            (strategy) => strategy.type === "visibleText" && strategy.text === "Look Up",
          ),
      ),
    ).toHaveLength(1);
    expect(surface.executed.filter((action) => action.type === "fill")).toHaveLength(1);
    expect(
      surface.executed.filter(
        (action) =>
          action.type === "click" &&
          action.target.strategies.some(
            (strategy) => strategy.type === "visibleText" && strategy.text === "Continue",
          ),
      ),
    ).toHaveLength(1);
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

  it("records handoff start, observations, resume, and end as human evidence", async () => {
    const surface = new FakeSurface();
    const handoff = new SessionHandoffController();
    const policy = new PolicyGuard({
      allowedOrigins: ["https://bank.example"],
      allowedActionTypes: ["click", "fill", "read"],
    });
    const { events, summaries, signals, evidence } = memoryEvidence();
    const engine = new ReplayEngine(surface, { policy, handoff, evidence });
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
      { runId: "run-hitl-log" },
    );
    await vi.waitFor(() => {
      expect(handoff.owner()).toBe("human");
    });
    handoff.signalResume();
    const result = await pending;
    expect(result.status).toBe("success");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "handoff_start",
        "observation",
        "resume_signal",
        "handoff_end",
        DETERMINISTIC_ACTION_EVENT,
        "result",
      ]),
    );
    expect(
      events.filter((event) => event.type === "observation" && event.actor === "human"),
    ).toHaveLength(2);
    expect(events.find((event) => event.type === "handoff_start")?.actor).toBe("human");
    expect(summaries[0]).toMatchObject({ status: "success", runId: "run-hitl-log" });
    expect(signals.some((signal) => signal.kind === "screenshot")).toBe(true);
  });
});

describe("ReplayEngine full-run evidence", () => {
  it("logs checkpoints, outputs, result, and summary on success without screenshots", async () => {
    const surface = new FakeSurface();
    const { events, summaries, signals, evidence } = memoryEvidence();
    const engine = new ReplayEngine(surface, { evidence });
    const result = await engine.run(
      testCapability({
        steps: [
          clickStep("open-lending", {
            preconditions: [{ type: "textVisible", value: "Home" }],
            postconditions: [{ type: "textVisible", value: "Lending Services" }],
          }),
        ],
      }),
      {},
      { runId: "run-success-log" },
    );
    expect(result.status).toBe("success");
    expect(events.map((event) => event.type)).toEqual([
      "run_start",
      "precondition",
      "policy",
      DETERMINISTIC_ACTION_EVENT,
      "postcondition",
      "success_check",
      "outputs",
      "result",
    ]);
    expect(events.find((event) => event.type === "precondition")?.payload).toMatchObject({
      stepId: "open-lending",
      status: "ok",
    });
    expect(events.find((event) => event.type === DETERMINISTIC_ACTION_EVENT)?.payload).toMatchObject({
      stepId: "open-lending",
      status: "ok",
    });
    expect(events.find((event) => event.type === "result")?.payload).toMatchObject({
      status: "success",
    });
    expect(summaries).toEqual([
      expect.objectContaining({
        runId: "run-success-log",
        runType: "replay",
        capabilityId: "loan-payoff",
        status: "success",
        steps: 1,
      }),
    ]);
    expect(signals).toEqual([]);
  });

  it("writes a failure summary after checkpoint and rich-signal events", async () => {
    const surface = new FakeSurface();
    surface.assertHandler = () => false;
    const { events, summaries, evidence } = memoryEvidence();
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
      { runId: "run-fail-log" },
    );
    expect(result.status).toBe("failure");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["precondition", "failure"]),
    );
    expect(summaries[0]).toMatchObject({
      status: "failure",
      runId: "run-fail-log",
      steps: 0,
    });
  });
});

