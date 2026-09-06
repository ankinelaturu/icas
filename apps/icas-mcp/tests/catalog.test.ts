/**
 * @file MCP tools are named and typed from CapabilityRegistry, not a glob.
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

import { z } from "zod";

import { catalogToolDefinitions, createIcasMcpServer } from "../src/create-server.js";
import {
  capabilityIdToToolName,
  mcpIdentityDefaults,
  mcpInputShape,
} from "../src/tool-schema.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

describe("MCP tool catalog", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-mcp-"));
    registry = new FileSystemCapabilityRegistry({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("maps loan-payoff to loan_payoff with typed inputs plus url and identity", () => {
    expect(capabilityIdToToolName("loan-payoff")).toBe("loan_payoff");
    const artifact = loadLoanPayoff();
    const shape = mcpInputShape(artifact);
    expect(Object.keys(shape).sort()).toEqual(
      ["loanAccountId", "payoffDate", "product", "tenant", "url", "vendor"].sort(),
    );
    expect(mcpIdentityDefaults(artifact)).toEqual({
      tenant: "icas-bank",
      vendor: "icas-bank",
      product: "icas-bank",
    });
    const parsed = z.object(shape).parse({
      url: "http://localhost:4101",
      loanAccountId: "987654",
      payoffDate: "2026-09-30",
    });
    expect(parsed.tenant).toBe("icas-bank");
    expect(parsed.vendor).toBe("icas-bank");
    expect(parsed.product).toBe("icas-bank");
  });

  it("defaults identity from the artifact target and discoveredOn tenant", () => {
    const helix = {
      ...loadLoanPayoff(),
      id: "share-hold",
      target: { vendor: "helix", product: "helix" },
      discoveredOn: { tenant: "helix-cu" },
    };
    expect(mcpIdentityDefaults(helix)).toEqual({
      tenant: "helix-cu",
      vendor: "helix",
      product: "helix",
    });
    const parsed = z.object(mcpInputShape(helix)).parse({
      url: "http://localhost:4103",
      loanAccountId: "987654",
      payoffDate: "2026-09-30",
    });
    expect(parsed.tenant).toBe("helix-cu");
    expect(parsed.vendor).toBe("helix");
    expect(parsed.product).toBe("helix");
  });

  it("registers one tool per catalog id", async () => {
    await registry.save(loadLoanPayoff());
    const tools = await catalogToolDefinitions(registry);
    expect(tools.map((tool) => tool.name)).toEqual(["loan_payoff"]);
    expect(tools[0]?.capabilityId).toBe("loan-payoff");
    await createIcasMcpServer(registry);
  });
});
