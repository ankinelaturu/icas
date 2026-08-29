import { describe, expect, it } from "vitest";

import { createRedactor } from "./create-redactor.js";

const SAMPLE =
  "Loan Search for 9876543210, SSN 123-45-6789, email teller@bank.example";

describe("Redactor profiles", () => {
  it("masks configured values and preserves unconfigured content", () => {
    const model = createRedactor("model");
    expect(model.redactText("Loan Search")).toBe("Loan Search");
    expect(model.redactText(SAMPLE)).toBe(
      "Loan Search for [MODEL_ACCOUNT], SSN [MODEL_SSN], email teller@bank.example",
    );
  });

  it("keeps model, evidence, and terminal profiles independent", () => {
    const model = createRedactor("model").redactText(SAMPLE);
    const evidence = createRedactor("evidence").redactText(SAMPLE);
    const terminal = createRedactor("terminal").redactText(SAMPLE);

    expect(model).toContain("[MODEL_SSN]");
    expect(model).not.toContain("[REDACTED_SSN]");
    expect(model).toContain("teller@bank.example");

    expect(evidence).toContain("[REDACTED_SSN]");
    expect(evidence).toContain("[REDACTED_EMAIL]");
    expect(evidence).not.toContain("[MODEL_SSN]");
    expect(evidence).not.toContain("teller@bank.example");

    expect(terminal).toContain("[SSN]");
    expect(terminal).not.toContain("[REDACTED_EMAIL]");
    expect(terminal).toContain("teller@bank.example");
    expect(terminal).not.toContain("[MODEL_ACCOUNT]");
  });

  it("redacts nested JSON without mutating the input", () => {
    const input = {
      note: "SSN 123-45-6789",
      nested: { email: "teller@bank.example", count: 2 },
      tags: ["ok", "123-45-6789"],
    };
    const redacted = createRedactor("evidence").redactValue(input);
    expect(redacted).toEqual({
      note: "SSN [REDACTED_SSN]",
      nested: { email: "[REDACTED_EMAIL]", count: 2 },
      tags: ["ok", "[REDACTED_SSN]"],
    });
    expect(input.note).toBe("SSN 123-45-6789");
  });
});
