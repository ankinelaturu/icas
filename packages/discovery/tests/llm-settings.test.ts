/**
 * @file Tests for per-flow LLM env resolution (no live network).
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ICAS_LLM_MODEL,
  isIcasLlmReady,
  resolveIcasLlmSettings,
  toMastraModelConfig,
  toMastraModelSettings,
} from "../src/llm-settings.js";

describe("resolveIcasLlmSettings", () => {
  it("resolves discovery and assist independently", () => {
    const env = {
      ICAS_DISCOVERY_LLM_MODEL: "openai/gpt-4o-mini",
      ICAS_DISCOVERY_LLM_API_KEY: "disc-key",
      ICAS_ASSIST_LLM_MODEL: "anthropic/claude-sonnet-4-6",
      ICAS_ASSIST_LLM_API_KEY: "assist-key",
    };
    const discovery = resolveIcasLlmSettings("discovery", env);
    const assist = resolveIcasLlmSettings("assist", env);
    expect(discovery.model).toBe("openai/gpt-4o-mini");
    expect(discovery.apiKey).toBe("disc-key");
    expect(assist.model).toBe("anthropic/claude-sonnet-4-6");
    expect(assist.apiKey).toBe("assist-key");
  });

  it("does not leak a discovery-only key into assist", () => {
    const env = { ICAS_DISCOVERY_LLM_API_KEY: "disc-only" };
    expect(isIcasLlmReady(resolveIcasLlmSettings("discovery", env))).toBe(true);
    expect(isIcasLlmReady(resolveIcasLlmSettings("assist", env))).toBe(false);
  });

  it("omits empty BASE_URL so the provider public host applies", () => {
    const settings = resolveIcasLlmSettings("discovery", {
      ICAS_DISCOVERY_LLM_API_KEY: "sk",
      ICAS_DISCOVERY_LLM_BASE_URL: "",
    });
    expect(settings.baseUrl).toBeUndefined();
  });

  it("is ready with a local BASE_URL and no cloud key", () => {
    const settings = resolveIcasLlmSettings("discovery", {
      ICAS_DISCOVERY_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    expect(isIcasLlmReady(settings)).toBe(true);
    expect(toMastraModelConfig(settings)).toEqual({
      id: DEFAULT_ICAS_LLM_MODEL,
      url: "http://127.0.0.1:11434/v1",
    });
  });

  it("is not ready when neither API_KEY nor BASE_URL is set", () => {
    expect(isIcasLlmReady(resolveIcasLlmSettings("discovery", {}))).toBe(false);
    expect(isIcasLlmReady(resolveIcasLlmSettings("assist", {}))).toBe(false);
  });

  it("falls back to ICAS_MODEL and OPENAI_API_KEY when new vars are empty", () => {
    const settings = resolveIcasLlmSettings("discovery", {
      ICAS_MODEL: "openai/gpt-4o-mini",
      OPENAI_API_KEY: "legacy-sk",
    });
    expect(settings.model).toBe("openai/gpt-4o-mini");
    expect(settings.apiKey).toBe("legacy-sk");
    expect(isIcasLlmReady(settings)).toBe(true);
  });

  it("prefers ICAS_DISCOVERY_LLM_MODEL over ICAS_MODEL", () => {
    expect(
      resolveIcasLlmSettings("discovery", {
        ICAS_DISCOVERY_LLM_MODEL: "openai/gpt-4o",
        ICAS_MODEL: "openai/gpt-4o-mini",
        ICAS_DISCOVERY_LLM_API_KEY: "sk",
      }).model,
    ).toBe("openai/gpt-4o");
  });

  it("prefers ICAS_DISCOVERY_LLM_API_KEY over OPENAI_API_KEY", () => {
    expect(
      resolveIcasLlmSettings("discovery", {
        ICAS_DISCOVERY_LLM_API_KEY: "new-key",
        OPENAI_API_KEY: "old-key",
      }).apiKey,
    ).toBe("new-key");
  });

  it("keeps temperature 0 and omits empty sampling", () => {
    const settings = resolveIcasLlmSettings("assist", {
      ICAS_ASSIST_LLM_API_KEY: "sk",
      ICAS_ASSIST_LLM_TEMPERATURE: "0",
      ICAS_ASSIST_LLM_TOP_K: "",
    });
    expect(settings.temperature).toBe(0);
    expect(settings.topK).toBeUndefined();
    expect(toMastraModelSettings(settings)).toEqual({ temperature: 0 });
  });

  it("throws when a sampling var is not a number", () => {
    expect(() =>
      resolveIcasLlmSettings("discovery", {
        ICAS_DISCOVERY_LLM_TEMPERATURE: "hot",
      }),
    ).toThrow(/ICAS_DISCOVERY_LLM_TEMPERATURE must be a number/);
  });
});
