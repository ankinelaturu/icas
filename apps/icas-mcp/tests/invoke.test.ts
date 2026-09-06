/**
 * @file MCP invoke goes through CapabilityResolver then ReplayEngine.
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

import { invokeMcpCapability } from "../src/invoke-replay.js";

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

describe("invokeMcpCapability", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-mcp-invoke-"));
    registry = new FileSystemCapabilityRegistry({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("fails when the tenant is not enrolled", async () => {
    await registry.save(loadLoanPayoff());
    await expect(
      invokeMcpCapability(
        {
          capabilityId: "loan-payoff",
          url: "https://loki.example/home",
          tenant: "icas-bank",
          inputs: { loanAccountId: "987654", payoffDate: "2026-09-30" },
        },
        { registry },
      ),
    ).rejects.toThrow(/not enrolled/);
  });

  it("resolves the enrolled tenant and delegates to ReplayEngine", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    const result = await invokeMcpCapability(
      {
        capabilityId: "loan-payoff",
        url: "https://loki.example/home",
        tenant: "icas-bank",
        inputs: { loanAccountId: "987654", payoffDate: "2026-09-30" },
      },
      {
        registry,
        executeReplay: async ({ capability, request }) => {
          expect(capability.id).toBe("loan-payoff");
          expect(request.tenant).toBe("icas-bank");
          expect(request.url).toBe("https://loki.example/home");
          return {
            status: "success",
            capabilityId: capability.id,
            outputs: { totalPayoffAmount: "1.00" },
            runId: "run-mcp",
          };
        },
      },
    );
    expect(result.status).toBe("success");
  });

  it("defaults omitted vendor and product to icas-bank", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await invokeMcpCapability(
      {
        capabilityId: "loan-payoff",
        url: "https://bank.example/home",
        tenant: "icas-bank",
        inputs: { loanAccountId: "987654", payoffDate: "2026-09-30" },
      },
      {
        registry,
        executeReplay: async ({ request }) => {
          expect(request.vendor).toBe("icas-bank");
          expect(request.product).toBe("icas-bank");
          return {
            status: "success",
            capabilityId: "loan-payoff",
            outputs: { totalPayoffAmount: "1.00" },
            runId: "run-mcp-identity",
          };
        },
      },
    );
  });

  it("rejects a vendor/product that does not match the artifact target", async () => {
    await registry.save(loadLoanPayoff());
    await registry.saveOverride(loadIcasBankOverride());
    await expect(
      invokeMcpCapability(
        {
          capabilityId: "loan-payoff",
          url: "https://bank.example/home",
          tenant: "icas-bank",
          vendor: "helix",
          product: "helix",
          inputs: { loanAccountId: "987654", payoffDate: "2026-09-30" },
        },
        {
          registry,
          executeReplay: async () => {
            throw new Error("replay must not run on identity mismatch");
          },
        },
      ),
    ).rejects.toThrow(/helix\/helix/);
  });
});
