/**
 * @file Tests for discovery model resolution (no live network).
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISCOVERY_MODEL,
  discoverySmokeEnabled,
  hasDiscoveryApiKey,
  resolveDiscoveryModel,
} from "./model-provider.js";

describe("resolveDiscoveryModel", () => {
  it("defaults to an image-capable OpenAI model", () => {
    expect(resolveDiscoveryModel({})).toBe(DEFAULT_DISCOVERY_MODEL);
  });

  it("honors ICAS_MODEL over inferred provider", () => {
    expect(
      resolveDiscoveryModel({
        ICAS_MODEL: "anthropic/claude-haiku-4-5",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toBe("anthropic/claude-haiku-4-5");
  });

  it("uses Anthropic when only ANTHROPIC_API_KEY is set", () => {
    expect(resolveDiscoveryModel({ ANTHROPIC_API_KEY: "ak-test" })).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });
});

describe("hasDiscoveryApiKey / discoverySmokeEnabled", () => {
  it("detects keys and keeps CI smoke off by default", () => {
    expect(hasDiscoveryApiKey({})).toBe(false);
    expect(hasDiscoveryApiKey({ OPENAI_API_KEY: "sk" })).toBe(true);
    expect(discoverySmokeEnabled({})).toBe(false);
    expect(discoverySmokeEnabled({ ICAS_DISCOVERY_SMOKE: "1" })).toBe(true);
  });
});
