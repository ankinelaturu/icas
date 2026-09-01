/**
 * @file Tests for discovery model resolution (no live network).
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISCOVERY_MODEL,
  discoverySmokeEnabled,
  hasDiscoveryApiKey,
  resolveDiscoveryModel,
} from "../src/model-provider.js";

describe("resolveDiscoveryModel", () => {
  it("defaults to an image-capable OpenAI model", () => {
    expect(resolveDiscoveryModel({})).toBe(DEFAULT_DISCOVERY_MODEL);
  });

  it("honors ICAS_DISCOVERY_LLM_MODEL", () => {
    expect(
      resolveDiscoveryModel({
        ICAS_DISCOVERY_LLM_MODEL: "anthropic/claude-haiku-4-5",
      }),
    ).toBe("anthropic/claude-haiku-4-5");
  });
});

describe("hasDiscoveryApiKey / discoverySmokeEnabled", () => {
  it("detects ICAS_DISCOVERY_LLM_* and keeps CI smoke off by default", () => {
    expect(hasDiscoveryApiKey({})).toBe(false);
    expect(hasDiscoveryApiKey({ ICAS_DISCOVERY_LLM_API_KEY: "sk" })).toBe(true);
    expect(
      hasDiscoveryApiKey({
        ICAS_DISCOVERY_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      }),
    ).toBe(true);
    expect(discoverySmokeEnabled({})).toBe(false);
    expect(discoverySmokeEnabled({ ICAS_DISCOVERY_SMOKE: "1" })).toBe(true);
  });
});
