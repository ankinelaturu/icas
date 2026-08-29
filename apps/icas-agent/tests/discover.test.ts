/**
 * @file icas-agent discover refuses existing ids and persists header-only enrollment.
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
import type { DiscoveryResult } from "@icas/discovery";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "../src/cli.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

function successEvents(): DiscoveryResult {
  return {
    status: "success",
    runId: "run-discover-test",
    events: [
      { type: "observation", payload: { id: "home", url: "http://localhost/home.html" } },
      {
        type: "chosen_action",
        payload: {
          rank: 1,
          action: {
            type: "click",
            target: { strategies: [{ type: "visibleText", text: "Lending" }] },
            risk: "safe",
          },
          expectation: "Lending Services",
        },
      },
      { type: "action_result", payload: { status: "ok" } },
      { type: "observation", payload: { id: "lending", url: "http://localhost/lending.html" } },
      { type: "success" },
    ],
  };
}

describe("icas-agent discover", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  const lines: string[] = [];
  const errors: string[] = [];
  let discoveryCalls: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-agent-"));
    registry = new FileSystemCapabilityRegistry({ root });
    lines.length = 0;
    errors.length = 0;
    discoveryCalls = 0;
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
      runDiscovery: async () => {
        discoveryCalls += 1;
        return successEvents();
      },
    };
  }

  it("requires --id, --url, and --goal", async () => {
    await runAgent(["node", "icas-agent", "discover"], deps());
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/required option/i);
    expect(discoveryCalls).toBe(0);
  });

  it("refuses an existing id unless --capability-version is explicit", async () => {
    await registry.save(loadLoanPayoff());
    await runAgent(
      [
        "node",
        "icas-agent",
        "discover",
        "--id",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--goal",
        "Generate a payoff statement",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/already exists/);
    expect(discoveryCalls).toBe(0);
  });

  it("persists the base artifact and a header-only override", async () => {
    await runAgent(
      [
        "node",
        "icas-agent",
        "discover",
        "--id",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--goal",
        "Generate a payoff statement",
        "--name",
        "Generate Loan Payoff Statement",
      ],
      deps(),
    );
    expect(errors).toEqual([]);
    expect(process.exitCode).toBe(0);
    expect(discoveryCalls).toBe(1);
    const artifact = await registry.get("loan-payoff");
    expect(artifact?.capabilityVersion).toBe("1.0.0");
    expect(artifact?.name).toBe("Generate Loan Payoff Statement");
    const overrides = await registry.listOverrides({ tenant: "icas-bank" });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.overrides).toEqual({});
    expect(overrides[0]?.provenance.createdBy).toBe("discovery");
    expect(lines.join("\n")).toContain("enrolled tenant: icas-bank");
  });

  it("does not infer tenant from --url", async () => {
    await runAgent(
      [
        "node",
        "icas-agent",
        "discover",
        "--id",
        "loan-payoff",
        "--url",
        "https://loki.example/home",
        "--goal",
        "Generate a payoff statement",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(0);
    const overrides = await registry.listOverrides({ tenant: "icas-bank" });
    expect(overrides).toHaveLength(1);
    expect(await registry.listOverrides({ tenant: "loki-bank" })).toEqual([]);
  });

  it("accepts an explicit version bump for an existing id", async () => {
    await registry.save(loadLoanPayoff());
    await runAgent(
      [
        "node",
        "icas-agent",
        "discover",
        "--id",
        "loan-payoff",
        "--url",
        "https://bank.example/home",
        "--goal",
        "Generate a payoff statement",
        "--capability-version",
        "1.1.0",
      ],
      deps(),
    );
    expect(process.exitCode).toBe(0);
    expect((await registry.get("loan-payoff"))?.capabilityVersion).toBe("1.1.0");
  });
});
