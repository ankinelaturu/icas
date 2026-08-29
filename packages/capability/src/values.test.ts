import { describe, expect, it } from "vitest";

import type { CapabilityArtifact } from "./artifact.js";
import {
  CapabilityTypeError,
  resolveValueRef,
  validateInputValues,
  validateOutputValues,
  validatePrimitiveValue,
} from "./values.js";

describe("validatePrimitiveValue", () => {
  it("accepts a string", () => {
    expect(() => validatePrimitiveValue("string", "987654")).not.toThrow();
  });

  it("rejects a non-string for string", () => {
    expect(() => validatePrimitiveValue("string", 987654)).toThrow(
      CapabilityTypeError,
    );
  });

  it("accepts a finite number", () => {
    expect(() => validatePrimitiveValue("number", 12.5)).not.toThrow();
  });

  it("rejects NaN and Infinity for number", () => {
    expect(() => validatePrimitiveValue("number", Number.NaN)).toThrow(
      /finite number/,
    );
    expect(() => validatePrimitiveValue("number", Number.POSITIVE_INFINITY)).toThrow(
      /finite number/,
    );
  });

  it("accepts a boolean", () => {
    expect(() => validatePrimitiveValue("boolean", false)).not.toThrow();
  });

  it("rejects 0 for boolean", () => {
    expect(() => validatePrimitiveValue("boolean", 0)).toThrow(/boolean/);
  });

  it("accepts a real ISO date", () => {
    expect(() => validatePrimitiveValue("date", "2026-08-28")).not.toThrow();
  });

  it("rejects an impossible calendar date", () => {
    expect(() => validatePrimitiveValue("date", "2026-02-31")).toThrow(/ISO date/);
  });

  it("accepts money as a finite number or decimal string", () => {
    expect(() => validatePrimitiveValue("money", 1234.56)).not.toThrow();
    expect(() => validatePrimitiveValue("money", "1234.56")).not.toThrow();
  });

  it("rejects a non-numeric money value", () => {
    expect(() => validatePrimitiveValue("money", "twelve")).toThrow(/money/);
  });
});

describe("resolveValueRef", () => {
  const inputs = { loanAccountId: "987654" };

  it("resolves an input reference", () => {
    expect(resolveValueRef({ input: "loanAccountId" }, inputs)).toBe("987654");
  });

  it("resolves a literal", () => {
    expect(resolveValueRef({ literal: "Active" }, inputs)).toBe("Active");
  });

  it("rejects a missing input name", () => {
    expect(() => resolveValueRef({ input: "payoffDate" }, inputs)).toThrow(
      /missing input "payoffDate"/,
    );
  });

  it("rejects a ref with both input and literal", () => {
    expect(() =>
      resolveValueRef({ input: "loanAccountId", literal: "x" }, inputs),
    ).toThrow(/exactly one/);
  });

  it("rejects a ref with neither input nor literal", () => {
    expect(() => resolveValueRef({}, inputs)).toThrow(/exactly one/);
  });
});

describe("validateInputValues", () => {
  const declared = {
    loanAccountId: { type: "string" as const, required: true },
    payoffDate: { type: "date" as const, required: true },
  } satisfies CapabilityArtifact["inputs"];

  it("accepts a complete typed input map", () => {
    expect(() =>
      validateInputValues(declared, {
        loanAccountId: "987654",
        payoffDate: "2026-08-28",
      }),
    ).not.toThrow();
  });

  it("rejects a missing required input", () => {
    expect(() =>
      validateInputValues(declared, { loanAccountId: "987654" }),
    ).toThrow(/missing required input "payoffDate"/);
  });

  it("rejects an unknown input name", () => {
    expect(() =>
      validateInputValues(declared, {
        loanAccountId: "987654",
        payoffDate: "2026-08-28",
        extra: true,
      }),
    ).toThrow(/unknown input "extra"/);
  });
});

describe("validateOutputValues", () => {
  const declared = {
    totalPayoffAmount: { type: "money" as const },
  } satisfies CapabilityArtifact["outputs"];

  it("accepts a matching money output", () => {
    expect(() =>
      validateOutputValues(declared, { totalPayoffAmount: "100.00" }),
    ).not.toThrow();
  });

  it("rejects a missing declared output", () => {
    expect(() => validateOutputValues(declared, {})).toThrow(
      /missing output "totalPayoffAmount"/,
    );
  });
});
