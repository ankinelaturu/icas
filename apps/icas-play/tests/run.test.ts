/**
 * @file icas-play run resolves an enrolled tenant then ReplayEngine (no LLM).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  FileSystemCapabilityRegistry,
  validateCapabilityArtifact,
  validateCapabilityOverride,
} from "@icas/capability";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runPlay } from "../src/cli.js";
import type { PlayReplayInvocation } from "../src/replay-session.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

function loadIcasBankOverride() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.override.icas-bank.json"),
    "utf8",
  );
  return validateCapabilityOverride(JSON.parse(raw) as unknown);
}

describe("icas-play run", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  const lines: string[] = [];
  const errors: string[] = [];
  let invocations: PlayReplayInvocation[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-play-run-"));
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

  function deps() {
    return {
      registry,
      stdout: (line: string) => {
        lines.push(line);
      },
      stderr: (line: string) => {
        errors.push(line);
      },
      executeReplay: async (invocation: PlayReplayInvocation) => {
        invocations.push(invocation);
        return {
          status: "success" as const,
          capabilityId: invocation.capability.id,
          outputs: { totalPayoffAmount: "100.00" },
          runId: "run-test",
        };
      },
    };
  }

  it("requires --url", async () => {
    await runPlay(["node", "icas-play", "run", "loan-payoff"], deps());
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/url/i);
    expect(invocations).toHaveLength(0);
  });

  it("fails when the tenant is not enrolled", async () => {
    await registry.save(loadLoanPayoff());
    await runPlay(
      [
        "node",
        "icas-play",
        "run",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/not enrolled|override/i);
    expect(invocations).toHaveLength(0);
  });

  it("defaults tenant to icas-bank and does not infer it from --url", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await runPlay(
      [
        "node",
        "icas-play",
        "run",
        "loan-payoff",
        "--url",
        "https://loki.example/home",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps(),
    );
    expect(errors).toEqual([]);
    expect(process.exitCode).toBe(0);
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation?.request.tenant).toBe("icas-bank");
    expect(invocation?.request.url).toBe("https://loki.example/home");
    expect(invocation?.request.inputs).toEqual({
      loanAccountId: "987654",
      payoffDate: "2026-09-30",
    });
    expect(invocation?.request.assist).toBe(false);
    expect(lines.join("\n")).toContain("status: success");
  });

  it("passes assist: true through to replay when --assist is set", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await runPlay(
      [
        "node",
        "icas-play",
        "run",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--assist",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(0);
    expect(invocations[0]?.request.assist).toBe(true);
  });

  it("accepts repeatable --input name=value", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await runPlay(
      [
        "node",
        "icas-play",
        "run",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--input",
        "loanAccountId=111",
        "--input",
        "payoffDate=2026-01-01",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(0);
    expect(invocations[0]?.request.inputs).toEqual({
      loanAccountId: "111",
      payoffDate: "2026-01-01",
    });
  });

  it("rejects a vendor/product that does not match the artifact target", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await runPlay(
      [
        "node",
        "icas-play",
        "run",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--vendor",
        "other-vendor",
        "--loanAccountId",
        "987654",
        "--payoffDate",
        "2026-09-30",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/other-vendor/);
    expect(invocations).toHaveLength(0);
  });
});
