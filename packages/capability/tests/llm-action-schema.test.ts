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

const clickBase = {
  intent: null as const,
  risk: "safe" as const,
  path: null,
  reason: null,
  value: null,
  proposedInputParam: null,
};

describe("llmActionToCapabilityAction", () => {
  it("maps a visibleText click onto a catalog click", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "click",
      ...clickBase,
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
      proposedInputParam: { name: "accountId", type: "string", required: true },
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
      proposedInputParam: { name: "accountId", type: "string", required: true },
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
      ...clickBase,
      target: {
        strategies: [{ ...nullStrategyFields, type: "visibleText", text: "Inquire" }],
      },
    });
    expect(llmActionToCapabilityAction(raw).target).toEqual({
      strategies: [{ type: "visibleText", text: "Inquire" }],
    });
  });

  it("keeps proposedInputParam off the catalog action", () => {
    const raw = LlmCapabilityActionSchema.parse({
      type: "fill",
      intent: null,
      risk: null,
      path: null,
      reason: null,
      value: "42",
      proposedInputParam: { name: "amount", type: "money", required: true },
      target: {
        strategies: [{ ...nullStrategyFields, type: "label", label: "Amount" }],
      },
    });
    expect(raw.proposedInputParam).toEqual({
      name: "amount",
      type: "money",
      required: true,
    });
    expect(llmActionToCapabilityAction(raw)).not.toHaveProperty("proposedInputParam");
  });

  it("rejects a non-camelCase proposedInputParam name", () => {
    expect(() =>
      LlmCapabilityActionSchema.parse({
        type: "fill",
        intent: null,
        risk: null,
        path: null,
        reason: null,
        value: "42",
        proposedInputParam: { name: "Account-Id", type: "string", required: true },
        target: {
          strategies: [{ ...nullStrategyFields, type: "label", label: "Account" }],
        },
      }),
    ).toThrow(/camelCase/);
  });
});
