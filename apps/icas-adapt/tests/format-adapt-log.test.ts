/**
 * @file Adapt CLI stage formatting stays labeled and includes rollback detail.
 */

import { describe, expect, it } from "vitest";

import {
  AdaptReverifyError,
  formatAdaptExecution,
  formatAdaptOutcome,
  formatGuardedReplayReport,
  formatOverrideSummary,
  formatPageTextPreview,
} from "../src/format-adapt-log.js";

describe("formatAdaptExecution", () => {
  it("prints failure code, step, and expected/observed", () => {
    const text = formatAdaptExecution({
      status: "failure",
      capabilityId: "loan-payoff",
      code: "TARGET_NOT_FOUND",
      stepId: "click-inquire",
      expected: { type: "textVisible", value: "Inquire" },
      observed: false,
      runId: "run-1",
    });
    expect(text).toContain("code: TARGET_NOT_FOUND");
    expect(text).toContain("step: click-inquire");
    expect(text).toContain("Inquire");
  });
});

describe("formatGuardedReplayReport", () => {
  it("names a mismatch and points at evidence", () => {
    const text = formatGuardedReplayReport(
      {
        status: "mismatch",
        stepId: "click-inquire",
        expected: "Inquire",
        observed: false,
        result: {
          status: "failure",
          capabilityId: "loan-payoff",
          code: "TARGET_NOT_FOUND",
          stepId: "click-inquire",
          runId: "run-1",
        },
      },
      "/tmp/evidence/loan-payoff/run-1",
    );
    expect(text).toContain("guarded replay: mismatch");
    expect(text).toContain("evidence: /tmp/evidence/loan-payoff/run-1");
  });
});

describe("formatOverrideSummary", () => {
  it("shows a one-step target patch", () => {
    const text = formatOverrideSummary({
      schemaVersion: "1.0",
      id: "loan-payoff-icas-banc",
      baseCapability: "loan-payoff",
      target: { tenant: "icas-banc" },
      overrides: {
        steps: {
          "click-inquire": {
            target: { strategies: [{ type: "visibleText", text: "Look Up" }] },
          },
        },
      },
      provenance: { createdBy: "icas-adapt", reason: "step click-inquire TARGET_NOT_FOUND" },
    });
    expect(text).toContain("createdBy: icas-adapt");
    expect(text).toContain("click-inquire");
    expect(text).toContain("Look Up");
  });
});

describe("formatPageTextPreview", () => {
  it("notes empty capture", () => {
    expect(formatPageTextPreview("")).toBe("page text: (none)");
  });

  it("dumps the full captured page text", () => {
    const body = "Look Up\n".repeat(80);
    const text = formatPageTextPreview(body);
    expect(text).toContain(body);
    expect(text).not.toContain("truncated");
  });
});

describe("formatAdaptOutcome", () => {
  it("does not reprint the first-run mismatch as the command status", () => {
    const text = formatAdaptOutcome({
      tenant: "icas-banc",
      report: {
        status: "mismatch",
        stepId: "click-inquire",
        expected: { type: "click", target: { strategies: [] } },
        observed: "next action target missing",
        result: {
          status: "failure",
          capabilityId: "loan-payoff",
          code: "UNEXPECTED_STATE",
          stepId: "click-inquire",
          runId: "run-first",
        },
      },
      override: {
        schemaVersion: "1.0",
        id: "loan-payoff-icas-banc",
        baseCapability: "loan-payoff",
        target: { tenant: "icas-banc" },
        overrides: {
          steps: {
            "click-inquire": {
              target: { strategies: [{ type: "visibleText", text: "Look Up" }] },
            },
          },
        },
        provenance: { createdBy: "icas-adapt", reason: "step click-inquire UNEXPECTED_STATE" },
      },
      reverify: {
        status: "success",
        capabilityId: "loan-payoff",
        outputs: { totalPayoffAmount: "8863.36" },
        runId: "run-reverify",
      },
    });
    expect(text).toContain("status: enrolled");
    expect(text).toContain("patched step: click-inquire");
    expect(text).toContain("first-run miss: UNEXPECTED_STATE (run-first)");
    expect(text).toContain("re-verify: success");
    expect(text).toContain("run-reverify");
    expect(text).toContain("8863.36");
    expect(text).toContain("enrollment kept");
    expect(text).not.toMatch(/^status: mismatch$/m);
    expect(text).not.toContain("next action target missing");
  });
});

describe("AdaptReverifyError", () => {
  it("embeds the re-verify stop in the message", () => {
    const error = new AdaptReverifyError({
      tenant: "icas-banc",
      reverify: {
        status: "failure",
        capabilityId: "loan-payoff",
        code: "TARGET_NOT_FOUND",
        stepId: "click-inquire",
        runId: "run-2",
      },
      evidenceDir: "/tmp/evidence/loan-payoff/run-2",
    });
    expect(error.message).toMatch(/rolled back/);
    expect(error.message).toContain("step: click-inquire");
    expect(error.message).toContain("/tmp/evidence/loan-payoff/run-2");
  });
});
