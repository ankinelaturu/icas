import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CapabilityOverrideValidationError,
  validateCapabilityOverride,
} from "../src/validate-override.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = join(repoRoot, "tests/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

describe("validateCapabilityOverride", () => {
  it("accepts a header-only enrollment override", () => {
    const override = validateCapabilityOverride(
      loadFixture("loan-payoff.override.icas-bank.json"),
    );
    expect(override.target.tenant).toBe("icas-bank");
    expect(override.overrides).toEqual({});
    expect(override.baseCapability).toBe("loan-payoff@1.0.0");
  });

  it("rejects executable customJavaScript-style patches", () => {
    try {
      validateCapabilityOverride(
        loadFixture("loan-payoff.override.js-patch.json"),
      );
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityOverrideValidationError);
      expect((error as CapabilityOverrideValidationError).message).toMatch(
        /executable|customJavaScript|unrecognized|invalid/i,
      );
    }
  });

  it("rejects a baseCapability that does not pin a version", () => {
    const valid = loadFixture("loan-payoff.override.icas-bank.json") as {
      baseCapability: string;
    };
    try {
      validateCapabilityOverride({ ...valid, baseCapability: "loan-payoff" });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityOverrideValidationError);
      expect((error as CapabilityOverrideValidationError).message).toMatch(
        /pin a version|baseCapability/,
      );
    }
  });
});
