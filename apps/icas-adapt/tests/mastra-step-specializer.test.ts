/**
 * @file Mastra step specializer returns a schema-valid StepOverride.
 */

import { describe, expect, it } from "vitest";

import type { CapabilityStep } from "@icas/capability";
import type { GuardedReplayReport } from "@icas/replay";

import {
  ADAPT_PAGE_TEXT_MAX,
  clipPageText,
  extractLlmObject,
  formatLlmGenerateLog,
  formatSpecializePrompt,
  hasAdaptLlm,
  llmStepOverrideToCatalog,
  MastraStepSpecializer,
  resolveAdaptModel,
} from "../src/mastra-step-specializer.js";

const clickStep: CapabilityStep = {
  id: "click-inquire",
  preconditions: [],
  action: {
    type: "click",
    target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
  },
  postconditions: [{ type: "textVisible", value: "Inquire" }],
};

function mismatchReport(): Extract<GuardedReplayReport, { status: "mismatch" }> {
  return {
    status: "mismatch",
    stepId: "click-inquire",
    expected: { type: "textVisible", value: "Inquire" },
    observed: false,
    result: {
      status: "failure",
      capabilityId: "loan-payoff",
      code: "TARGET_NOT_FOUND",
      stepId: "click-inquire",
      runId: "run-adapt-1",
    },
  };
}

function lookUpLlmObject() {
  return {
    target: {
      ref: null,
      strategies: [
        {
          type: "roleText" as const,
          role: "button",
          text: "Look Up",
          label: null,
          selector: null,
          xpath: null,
          x: null,
          y: null,
          confidence: null,
        },
        {
          type: "visibleText" as const,
          role: null,
          text: "Look Up",
          label: null,
          selector: null,
          xpath: null,
          x: null,
          y: null,
          confidence: null,
        },
      ],
    },
    postconditionText: "Look Up",
    rationale: "Search submit is Look Up, not Inquire",
  };
}

/**
 * Shape Mastra returns at runtime: structured `object`, escaped JSON in
 * `text`, plus nested usage/steps/messages that must not dump to stdout.
 */
function mastraGenerateResult(object: ReturnType<typeof lookUpLlmObject>) {
  return {
    object,
    text: JSON.stringify(object),
    usage: {
      inputTokens: 1200,
      outputTokens: 80,
      totalTokens: 1280,
      raw: { raw: { usage: { prompt_tokens: 1200 } } },
    },
    steps: [{ type: "tool", text: JSON.stringify(object) }],
    messages: {
      all: [{ role: "user", content: "full prompt echo click-inquire" }],
    },
  };
}

describe("MastraStepSpecializer", () => {
  it("maps Look Up chrome onto a target-only StepOverride", async () => {
    const specializer = new MastraStepSpecializer({
      generate: async () => ({ object: lookUpLlmObject() }),
    });
    const patch = await specializer.specialize({
      step: clickStep,
      report: mismatchReport(),
      pageText: "Loan Search\nLook Up\nLoan Account Number",
    });
    expect(patch.target?.strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "roleText", role: "button", text: "Look Up" }),
        expect.objectContaining({ type: "visibleText", text: "Look Up" }),
      ]),
    );
    expect(patch.postconditions).toEqual([{ type: "textVisible", value: "Look Up" }]);
  });

  it("passes sampling as generate modelSettings", async () => {
    let seen: unknown;
    const specializer = new MastraStepSpecializer(
      {
        generate: async (_messages, options) => {
          seen = options.modelSettings;
          return { object: lookUpLlmObject() };
        },
      },
      { settings: { model: "openai/gpt-4o", apiKey: "sk", temperature: 0 } },
    );
    await specializer.specialize({
      step: clickStep,
      report: mismatchReport(),
      pageText: "Look Up",
    });
    expect(seen).toEqual({ temperature: 0 });
  });

  it("logs system instructions, exact user prompt, and structured response", async () => {
    const lines: string[] = [];
    const specializer = new MastraStepSpecializer(
      {
        generate: async () => mastraGenerateResult(lookUpLlmObject()),
      },
      {
        settings: { model: "openai/gpt-4o", apiKey: "sk-secret-do-not-print", temperature: 0 },
        instructions: "SYSTEM CONTRACT TEXT",
        log: (line) => {
          lines.push(line);
        },
      },
    );
    await specializer.specialize({
      step: clickStep,
      report: mismatchReport(),
      pageText: "Loan Search\nLook Up",
    });
    const dump = lines.join("\n");
    expect(dump).toContain("LLM agent instructions (system):");
    expect(dump).toContain("SYSTEM CONTRACT TEXT");
    expect(dump).toContain("LLM user prompt (exact generate message):");
    expect(dump).toContain("click-inquire");
    expect(dump).toContain("Loan Search");
    expect(dump).toContain("LLM response:");
    expect(dump).toContain("LLM usage: input=1200 output=80 total=1280");
    expect(dump).toContain('"text": "Look Up"');
    expect(dump).toContain("LLM rationale:");
    expect(dump).toContain("LLM mapped StepOverride:");
    expect(dump).not.toContain("LLM raw response:");
    expect(dump).not.toContain("prompt_tokens");
    expect(dump).not.toContain("full prompt echo");
    expect(dump).not.toContain("sk-secret-do-not-print");
    expect(dump).toContain('"hasApiKey": true');
  });

  it("rejects prose-shaped output", async () => {
    const specializer = new MastraStepSpecializer({
      generate: async () => ({ object: { text: "just click Look Up" } }),
    });
    await expect(
      specializer.specialize({
        step: clickStep,
        report: mismatchReport(),
        pageText: "Look Up",
      }),
    ).rejects.toThrow(/invalid StepOverride/);
  });
});

describe("adapt LLM helpers", () => {
  it("honors ICAS_ADAPT_LLM_MODEL", () => {
    expect(
      resolveAdaptModel({
        ICAS_ADAPT_LLM_MODEL: "openai/gpt-4o-mini",
      }),
    ).toBe("openai/gpt-4o-mini");
  });

  it("detects ICAS_ADAPT_LLM_* and ignores assist keys", () => {
    expect(hasAdaptLlm({})).toBe(false);
    expect(hasAdaptLlm({ ICAS_ASSIST_LLM_API_KEY: "sk-assist" })).toBe(false);
    expect(hasAdaptLlm({ ICAS_ADAPT_LLM_API_KEY: "sk-adapt" })).toBe(true);
    expect(
      hasAdaptLlm({ ICAS_ADAPT_LLM_BASE_URL: "http://127.0.0.1:1234/v1" }),
    ).toBe(true);
  });

  it("includes the failed step and page chrome in the prompt", () => {
    const prompt = formatSpecializePrompt({
      step: clickStep,
      report: mismatchReport(),
      pageText: "Look Up",
    });
    expect(prompt).toContain("click-inquire");
    expect(prompt).toContain("Look Up");
    expect(prompt).toContain("Inquire");
  });

  it("clips oversized page text", () => {
    const clipped = clipPageText("x".repeat(ADAPT_PAGE_TEXT_MAX + 50));
    expect(clipped.length).toBeLessThan(ADAPT_PAGE_TEXT_MAX + 50);
    expect(clipped).toContain("…[truncated]");
  });

  it("maps a null postconditionText to a target-only patch", () => {
    const patch = llmStepOverrideToCatalog(
      { ...lookUpLlmObject(), postconditionText: null },
      clickStep.action,
    );
    expect(patch.postconditions).toBeUndefined();
    expect(patch.target?.strategies[0]).toMatchObject({ text: "Look Up" });
  });
});

describe("formatLlmGenerateLog", () => {
  it("pretty-prints the structured object and omits the Mastra envelope", () => {
    const log = formatLlmGenerateLog(mastraGenerateResult(lookUpLlmObject()));
    expect(log).toContain("LLM response:");
    expect(log).toContain('"text": "Look Up"');
    expect(log).toContain("Search submit is Look Up, not Inquire");
    expect(log).toContain("LLM usage: input=1200 output=80 total=1280");
    expect(log).not.toContain("prompt_tokens");
    expect(log).not.toContain("full prompt echo");
    expect(log).not.toContain('\\"target\\"');
  });

  it("parses escaped JSON from text when object is missing", () => {
    const object = lookUpLlmObject();
    expect(extractLlmObject({ text: JSON.stringify(object) })).toEqual(object);
    const log = formatLlmGenerateLog({ text: JSON.stringify(object) });
    expect(log).toContain('"text": "Look Up"');
    expect(log).not.toContain('\\"text\\"');
  });
});
