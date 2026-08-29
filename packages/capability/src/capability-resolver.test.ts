import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapabilityArtifact, CapabilityStep } from "./artifact.js";
import type { CapabilityOverride } from "./capability-override.js";
import {
  CapabilityResolveError,
  CapabilityResolver,
} from "./capability-resolver.js";
import { FileSystemCapabilityRegistry } from "./filesystem-capability-registry.js";
import {
  CapabilityValidationError,
  validateCapabilityArtifact,
} from "./validate-capability.js";
import { validateCapabilityOverride } from "./validate-override.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff(): CapabilityArtifact {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

function headerOverride(): CapabilityOverride {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.override.icas-bank.json"),
    "utf8",
  );
  return validateCapabilityOverride(JSON.parse(raw) as unknown);
}

function extraStep(id: string): CapabilityStep {
  return {
    id,
    preconditions: [],
    action: {
      type: "click",
      target: {
        strategies: [{ type: "visibleText", text: "Continue" }],
      },
      risk: "safe",
    },
    postconditions: [],
  };
}

function replacementStep(): CapabilityStep {
  return {
    id: "open-lending",
    preconditions: [{ type: "textVisible", value: "Portal" }],
    action: {
      type: "click",
      target: {
        strategies: [{ type: "visibleText", text: "Member Lending" }],
      },
      risk: "safe",
    },
    postconditions: [{ type: "textVisible", value: "Member Lending" }],
  };
}

describe("CapabilityResolver", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-resolve-"));
    registry = new FileSystemCapabilityRegistry({ root });
    resolver = new CapabilityResolver(registry);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("applies a whole-step replace on an enrolled tenant", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        steps: {
          "open-lending": { step: replacementStep() },
        },
      },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    const first = effective.steps[0];
    expect(first?.action).toMatchObject({
      type: "click",
      target: {
        strategies: [{ type: "visibleText", text: "Member Lending" }],
      },
    });
    expect(effective.steps[1]?.id).toBe("open-loan-search");
  });

  it("refuses an override pinned to a different base version", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.save({ ...base, capabilityVersion: "1.1.0" });
    await registry.saveOverride(headerOverride());
    await expect(
      resolver.resolve({ id: "loan-payoff", version: "1.1.0", tenant: "icas-bank" }),
    ).rejects.toThrow(/incompatible/i);
  });

  it("rejects an invalid resolved artifact", async () => {
    const base = loadLoanPayoff();
    const duplicate = replacementStep();
    duplicate.id = "open-loan-search";
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        steps: {
          "open-lending": { step: duplicate },
        },
      },
    });
    await expect(
      resolver.resolve({ id: "loan-payoff", tenant: "icas-bank" }),
    ).rejects.toBeInstanceOf(CapabilityValidationError);
  });

  it("fails when the tenant is not enrolled", async () => {
    await registry.save(loadLoanPayoff());
    await expect(
      resolver.resolve({ id: "loan-payoff", tenant: "icas-bank" }),
    ).rejects.toBeInstanceOf(CapabilityResolveError);
  });

  it("returns the base unchanged for a header-only override", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.saveOverride(headerOverride());
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    expect(effective.steps.map((step) => step.id)).toEqual(
      base.steps.map((step) => step.id),
    );
  });

  it("replaces only the target and preserves the rest of the step", async () => {
    const base = loadLoanPayoff();
    const original = base.steps[0];
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        steps: {
          "open-lending": {
            target: {
              strategies: [{ type: "visibleText", text: "Member Lending" }],
            },
          },
        },
      },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    const step = effective.steps[0];
    expect(step?.preconditions).toEqual(original?.preconditions);
    expect(step?.postconditions).toEqual(original?.postconditions);
    expect(step?.action).toMatchObject({
      type: "click",
      intent: original?.action.type === "click" ? original.action.intent : undefined,
      target: {
        strategies: [{ type: "visibleText", text: "Member Lending" }],
      },
    });
  });

  it("replaces only preconditions and preserves the action", async () => {
    const base = loadLoanPayoff();
    const original = base.steps[0];
    await registry.save(base);
    const preconditions = [{ type: "textVisible" as const, value: "Portal Home" }];
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        steps: { "open-lending": { preconditions } },
      },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    const step = effective.steps[0];
    expect(step?.preconditions).toEqual(preconditions);
    expect(step?.action).toEqual(original?.action);
    expect(step?.postconditions).toEqual(original?.postconditions);
  });

  it("replaces only postconditions and preserves the action", async () => {
    const base = loadLoanPayoff();
    const original = base.steps[0];
    await registry.save(base);
    const postconditions = [
      { type: "textVisible" as const, value: "Member Lending" },
    ];
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        steps: { "open-lending": { postconditions } },
      },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    const step = effective.steps[0];
    expect(step?.postconditions).toEqual(postconditions);
    expect(step?.action).toEqual(original?.action);
    expect(step?.preconditions).toEqual(original?.preconditions);
  });

  it("inserts steps before and after a known step id", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        insertBefore: {
          "open-loan-search": [extraStep("accept-disclosure")],
        },
        insertAfter: {
          "open-loan-search": [extraStep("confirm-search")],
        },
      },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    expect(effective.steps.map((step) => step.id)).toEqual([
      "open-lending",
      "accept-disclosure",
      "open-loan-search",
      "confirm-search",
      "enter-loan-account",
      "inquire-loan",
      "open-payoff",
      "enter-payoff-date",
      "generate-statement",
    ]);
  });

  it("disables a known step", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: { disabledSteps: ["open-loan-search"] },
    });
    const effective = await resolver.resolve({
      id: "loan-payoff",
      tenant: "icas-bank",
    });
    expect(effective.steps.map((step) => step.id)).toEqual([
      "open-lending",
      "enter-loan-account",
      "inquire-loan",
      "open-payoff",
      "enter-payoff-date",
      "generate-statement",
    ]);
  });

  it("errors when the referenced step id does not exist", async () => {
    const base = loadLoanPayoff();
    await registry.save(base);
    await registry.saveOverride({
      ...headerOverride(),
      overrides: {
        insertBefore: { "missing-step": [extraStep("ghost")] },
      },
    });
    await expect(
      resolver.resolve({ id: "loan-payoff", tenant: "icas-bank" }),
    ).rejects.toThrow(/unknown step id "missing-step"/);
  });
});
