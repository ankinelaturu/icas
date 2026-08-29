/**
 * @file icas-adapt guarded replay loads the base and stops at the first mismatch.
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

describe("icas-adapt guarded replay", () => {
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

  function deps(result: "mismatch" | "compatible") {
    return {
      registry,
      stdout: (line: string) => {
        lines.push(line);
      },
      stderr: (line: string) => {
        errors.push(line);
      },
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
        return {
          status: "failure" as const,
          capabilityId: invocation.capability.id,
          code: "TARGET_NOT_FOUND",
          stepId: "open-lending",
          expected: { type: "textVisible", value: "Lending" },
          observed: false,
          runId: "run-adapt-miss",
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

  it("replays the base artifact (not an enrolled resolve) and reports mismatch", async () => {
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
      deps("mismatch"),
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.request.tenant).toBe("loki-bank");
    expect(invocations[0]?.capability.id).toBe("loan-payoff");
    expect(lines.join("\n")).toContain("status: mismatch");
    expect(lines.join("\n")).toContain("step: open-lending");
    expect(process.exitCode).toBe(1);
    expect(await registry.listOverrides({ tenant: "loki-bank" })).toEqual([]);
  });

  it("does not infer tenant from --url", async () => {
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
    expect(lines.join("\n")).toContain("status: compatible");
  });
});
