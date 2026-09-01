import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CapabilityValidationError,
  validateCapabilityArtifact,
} from "../src/validate-capability.js";

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
    }
  });

  it("accepts possibleOutcomes on the inquire-loan fixture step", () => {
    const artifact = validateCapabilityArtifact(
      loadFixture("loan-payoff.capability.json"),
    );
    const inquire = artifact.steps.find((step) => step.id === "inquire-loan");
    expect(inquire?.possibleOutcomes).toEqual([
      {
        kind: "error",
        match: { phrases: ["Loan not found"] },
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
      },
    ]);
  });

  it("accepts an empty possibleOutcomes array", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      steps: Array<Record<string, unknown> & { id: string }>;
    };
    const steps = valid.steps.map((step) =>
      step.id === "open-lending" ? { ...step, possibleOutcomes: [] } : step,
    );
    const artifact = validateCapabilityArtifact({ ...valid, steps });
    expect(artifact.steps[0]?.possibleOutcomes).toEqual([]);
  });

  it("rejects an unknown possibleOutcomes kind", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      steps: Array<Record<string, unknown> & { id: string }>;
    };
    const steps = valid.steps.map((step) => {
      if (step.id !== "inquire-loan") {
        return step;
      }
      return {
        ...step,
        possibleOutcomes: [
          {
            kind: "timeout",
            match: { phrases: ["Loan not found"] },
            heading: "Loan not found",
            summary: "No loan matches the requested account id.",
          },
        ],
      };
    });
    try {
      validateCapabilityArtifact({ ...valid, steps });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(/kind|success|error|hitl/i);
    }
  });

  it("rejects empty match.phrases", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      steps: Array<Record<string, unknown> & { id: string }>;
    };
    const steps = valid.steps.map((step) => {
      if (step.id !== "inquire-loan") {
        return step;
      }
      return {
        ...step,
        possibleOutcomes: [
          {
            kind: "error",
            match: { phrases: [] },
            heading: "Loan not found",
            summary: "No loan matches the requested account id.",
          },
        ],
      };
    });
    try {
      validateCapabilityArtifact({ ...valid, steps });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(/phrases/i);
    }
  });

  it("rejects more than three match.phrases", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      steps: Array<Record<string, unknown> & { id: string }>;
    };
    const steps = valid.steps.map((step) => {
      if (step.id !== "inquire-loan") {
        return step;
      }
      return {
        ...step,
        possibleOutcomes: [
          {
            kind: "error",
            match: {
              phrases: [
                "Loan not found",
                "No matching loan",
                "Account is not on file",
                "Unknown loan number",
              ],
            },
            heading: "Loan not found",
            summary: "No loan matches the requested account id.",
          },
        ],
      };
    });
    try {
      validateCapabilityArtifact({ ...valid, steps });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(/phrases/i);
    }
  });

  it("rejects leftover capabilityVersion as an unknown key", () => {
    const valid = loadFixture("loan-payoff.capability.json") as Record<
      string,
      unknown
    >;
    try {
      validateCapabilityArtifact({ ...valid, capabilityVersion: "1.0.0" });
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityValidationError);
      expect((error as CapabilityValidationError).message).toMatch(
        /unrecognized key|capabilityVersion/i,
      );
    }
  });

  it("rejects a ValueRef that sets both input and literal", () => {
    const valid = loadFixture("loan-payoff.capability.json") as {
      steps: Array<{ action: { type: string; value?: unknown } }>;
    };
    const steps = valid.steps.map((step) => {
      if (step.action.type !== "fill") {
        return step;
      }
      return {
        ...step,
        action: {
          ...step.action,
          value: { input: "loanAccountId", literal: "hard-coded" },
        },
      };
    });
    expect(() => validateCapabilityArtifact({ ...valid, steps })).toThrow(
      /exactly one of input or literal/,
    );
  });
});
