/**
 * @file icas-adapt writes a header-only or one-step override after guarded replay.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  FileSystemCapabilityRegistry,
  validateCapabilityArtifact,
} from "@icas/capability";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAdapt } from "../src/cli.js";
import type { AdaptReplayInvocation } from "../src/adapt-session.js";
import type { StepSpecializer } from "../src/build-override.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

const memberLendingSpecializer: StepSpecializer = {
  async specialize() {
    return {
      target: {
        strategies: [
          { type: "roleText", role: "link", text: "Member Lending" },
          { type: "visibleText", text: "Member Lending" },
        ],
      },
      postconditions: [{ type: "textVisible", value: "Member Lending" }],
    };
  },
};

describe("icas-adapt override generation", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  const lines: string[] = [];
  const errors: string[] = [];
  let invocations: AdaptReplayInvocation[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-adapt-"));
    registry = new FileSystemCapabilityRegistry({ root });
    lines.length = 0;
    errors.length = 0;
    invocations = [];
    process.exitCode = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function deps(result: "mismatch" | "compatible", specializer?: StepSpecializer) {
    return {
      registry,
      stdout: (line: string) => {
        lines.push(line);
      },
      stderr: (line: string) => {
        errors.push(line);
      },
      ...(specializer === undefined ? {} : { specializer }),
      executeReplay: async (invocation: AdaptReplayInvocation) => {
        invocations.push(invocation);
        if (result === "compatible") {
          return {
            status: "success" as const,
            capabilityId: invocation.capability.id,
            outputs: {},
            runId: "run-adapt-ok",
          };
        }
        // First call is the unenrolled base (mismatch). Second is resolve+replay.
        if (invocations.length === 1) {
          return {
            status: "failure" as const,
            capabilityId: invocation.capability.id,
            code: "TARGET_NOT_FOUND",
            stepId: "open-lending",
            expected: { type: "textVisible", value: "Lending" },
            observed: false,
            runId: "run-adapt-miss",
          };
        }
        return {
          status: "success" as const,
          capabilityId: invocation.capability.id,
          outputs: {},
          runId: "run-adapt-reverify",
        };
      },
    };
  }

  it("requires --tenant and --url", async () => {
    await runAdapt(["node", "icas-adapt", "loan-payoff"], deps("mismatch"));
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/required option/i);
    expect(invocations).toHaveLength(0);
  });

  it("still parses --tenant after the -- pnpm inserts before the id", async () => {
    await registry.save(loadLoanPayoff());
    await runAdapt(
      [
        "node",
        "icas-adapt",
        "--",
        "loan-payoff",
        "--tenant",
        "loki-bank",
        "--url",
        "https://icas.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps("compatible"),
    );
    expect(process.exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(invocations[0]?.request.tenant).toBe("loki-bank");
    expect(await registry.listOverrides({ tenant: "loki-bank" })).toHaveLength(1);
  });

  it("writes a one-step icas-adapt override around the divergent step", async () => {
    await registry.save(loadLoanPayoff());
    await runAdapt(
      [
        "node",
        "icas-adapt",
        "loan-payoff",
        "--tenant",
        "loki-bank",
        "--url",
        "https://loki.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps("mismatch", memberLendingSpecializer),
    );
    expect(lines.join("\n")).toContain("status: mismatch");
    expect(lines.join("\n")).toContain("override provenance: icas-adapt");
    const overrides = await registry.listOverrides({ tenant: "loki-bank" });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.provenance.createdBy).toBe("icas-adapt");
    expect(overrides[0]?.overrides.steps?.["open-lending"]?.target?.strategies[0]).toMatchObject({
      text: "Member Lending",
    });
    expect(invocations).toHaveLength(2);
    const reverified = invocations[1]?.capability.steps.find((step) => step.id === "open-lending");
    expect(reverified?.action).toMatchObject({
      type: "click",
      target: {
        strategies: expect.arrayContaining([
          expect.objectContaining({ text: "Member Lending" }),
        ]),
      },
    });
  });

  it("writes a header-only verified override when the base already matches", async () => {
    await registry.save(loadLoanPayoff());
    await runAdapt(
      [
        "node",
        "icas-adapt",
        "loan-payoff",
        "--tenant",
        "loki-bank",
        "--url",
        "https://icas.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps("compatible"),
    );
    expect(invocations[0]?.request.tenant).toBe("loki-bank");
    expect(invocations[0]?.request.url).toBe("https://icas.example/home");
    expect(lines.join("\n")).toContain("createdBy: verified");
    const overrides = await registry.listOverrides({ tenant: "loki-bank" });
    expect(overrides[0]?.overrides).toEqual({});
    expect(overrides[0]?.provenance.createdBy).toBe("verified");
    expect(invocations).toHaveLength(2);
  });

  it("rolls back the override when re-verify checkpoints fail", async () => {
    await registry.save(loadLoanPayoff());
    await runAdapt(
      [
        "node",
        "icas-adapt",
        "loan-payoff",
        "--tenant",
        "loki-bank",
        "--url",
        "https://loki.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      {
        ...deps("mismatch", memberLendingSpecializer),
        executeReplay: async (invocation: AdaptReplayInvocation) => {
          invocations.push(invocation);
          return {
            status: "failure" as const,
            capabilityId: invocation.capability.id,
            code: "TARGET_NOT_FOUND",
            stepId: "open-lending",
            expected: { type: "textVisible", value: "Lending" },
            observed: false,
            runId: "run-adapt-fail-both",
          };
        },
      },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/failed re-verify/);
    expect(await registry.listOverrides({ tenant: "loki-bank" })).toEqual([]);
  });
});
