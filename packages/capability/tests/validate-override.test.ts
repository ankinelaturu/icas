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
    expect(override.baseCapability).toBe("loan-payoff");
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

  it("accepts a StepOverride that only replaces possibleOutcomes", () => {
    const valid = loadFixture("loan-payoff.override.icas-bank.json") as {
      overrides: Record<string, unknown>;
    };
    const override = validateCapabilityOverride({
      ...valid,
      overrides: {
        steps: {
          "inquire-loan": {
            possibleOutcomes: [
              {
                kind: "error",
                match: { phrases: ["Account not on file"] },
                heading: "Account not on file",
                summary: "Tenant wording for a missing loan.",
              },
            ],
          },
        },
      },
    });
    expect(override.overrides.steps?.["inquire-loan"]?.possibleOutcomes).toEqual([
      {
        kind: "error",
        match: { phrases: ["Account not on file"] },
        heading: "Account not on file",
        summary: "Tenant wording for a missing loan.",
      },
    ]);
  });

  it("rejects a baseCapability that still uses an @version pin", () => {
    const valid = loadFixture("loan-payoff.override.icas-bank.json") as {
      baseCapability: string;
    };
    try {
      validateCapabilityOverride({
        ...valid,
        baseCapability: "loan-payoff@1.0.0",
      });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityOverrideValidationError);
      expect((error as CapabilityOverrideValidationError).message).toMatch(
        /catalog id|baseCapability/,
      );
    }
  });
});
