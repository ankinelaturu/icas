/**
 * @file llmActionToCapabilityAction maps flat OpenAI JSON onto catalog actions.
 */

import { describe, expect, it } from "vitest";

import {
  llmActionToCapabilityAction,
  LlmCapabilityActionSchema,
} from "../src/llm-action-schema.js";

const nullStrategyFields = {
  role: null,
  text: null,
  label: null,
  selector: null,
  xpath: null,
  x: null,
  y: null,
  confidence: null,
};

describe("llmActionToCapabilityAction", () => {
  it("maps a visibleText click onto a catalog click", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "click",
      intent: null,
      risk: "safe",
      path: null,
      reason: null,
      value: null,
      target: {
        strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Lending" }],
      },
    });
    expect(llmActionToCapabilityAction(raw)).toEqual({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Lending" }] },
      risk: "safe",
    });
  });

  it("maps fill value to a literal ValueRef", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "fill",
      intent: null,
      risk: null,
      path: null,
      reason: null,
      value: "987654",
      target: {
        strategies: [{ ...nullStrategyFields, type: "label", label: "LN Acct #" }],
      },
    });
    expect(llmActionToCapabilityAction(raw)).toMatchObject({
      type: "fill",
      value: { literal: "987654" },
      target: {
        strategies: [
          { type: "label", label: "LN Acct #" },
          { type: "relative", text: "LN Acct #" },
        ],
      },
    });
  });

  it("prefers relative when fill uses type=label but puts the caption in text", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "fill",
      intent: null,
      risk: "safe",
      path: null,
      reason: null,
      value: "987654",
      target: {
        strategies: [
          {
            ...nullStrategyFields,
            type: "label",
            role: "textbox",
            text: "LN Acct #",
            confidence: 0.9,
          },
        ],
      },
    });
    expect(llmActionToCapabilityAction(raw)).toEqual({
      type: "fill",
      target: {
        strategies: [
          { type: "relative", text: "LN Acct #", confidence: 0.9 },
          { type: "label", label: "LN Acct #", confidence: 0.9 },
        ],
      },
      value: { literal: "987654" },
      risk: "safe",
    });
  });

  it("does not add a relative fallback on click", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "click",
      intent: null,
      risk: "safe",
      path: null,
      reason: null,
      value: null,
      target: {
        strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Inquire" }],
      },
    });
    expect(llmActionToCapabilityAction(raw).target).toEqual({
      strategies: [{ type: "visibleText", text: "Inquire" }],
    });
  });
});
