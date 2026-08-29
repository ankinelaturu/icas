import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CapabilityValidationError,
  validateCapabilityArtifact,
} from "./validate-capability.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = join(repoRoot, "tests/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

describe("validateCapabilityArtifact", () => {
  it("accepts the loan-payoff test fixture", () => {
    const artifact = validateCapabilityArtifact(
      loadFixture("loan-payoff.capability.json"),
    );
    expect(artifact.id).toBe("loan-payoff");
    expect(artifact.schemaVersion).toBe("1.0");
    expect(artifact.capabilityVersion).toBe("1.0.0");
  });

  it("rejects a truncated artifact missing required fields", () => {
    expect(() =>
      validateCapabilityArtifact(
        loadFixture("loan-payoff.capability.truncated.json"),
      ),
    ).toThrow(CapabilityValidationError);

    try {
      validateCapabilityArtifact(
        loadFixture("loan-payoff.capability.truncated.json"),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(/steps/i);
    }
  });

  it("rejects an unknown action type", () => {
    try {
      validateCapabilityArtifact(
        loadFixture("loan-payoff.capability.unknown-action.json"),
      );
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      const message = (error as CapabilityValidationError).message;
      expect(message).toMatch(/action/i);
      expect(message).toMatch(/hover|click|fill|select/i);
    }
  });

  it("rejects a semver-shaped schemaVersion so format and flow versions stay distinct", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      schemaVersion: string;
    };
    try {
      validateCapabilityArtifact({ ...valid, schemaVersion: "1.0.0" });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(
        /schemaVersion/,
      );
      expect((error as CapabilityValidationError).message).not.toMatch(
        /capabilityVersion must be a three-part/,
      );
    }
  });

  it("rejects a two-part capabilityVersion so format and flow versions stay distinct", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      capabilityVersion: string;
    };
    try {
      validateCapabilityArtifact({ ...valid, capabilityVersion: "1.0" });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(
        /capabilityVersion/,
      );
    }
  });
});
