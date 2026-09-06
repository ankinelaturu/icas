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

import { catalogToolDefinitions, createIcasMcpServer } from "../src/create-server.js";
import { capabilityIdToToolName, mcpInputShape } from "../src/tool-schema.js";

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
    const shape = mcpInputShape(loadLoanPayoff());
    expect(Object.keys(shape).sort()).toEqual(
      ["loanAccountId", "payoffDate", "product", "tenant", "url", "vendor"].sort(),
    );
  });

  it("registers one tool per catalog id", async () => {
    await registry.save(loadLoanPayoff());
    const tools = await catalogToolDefinitions(registry);
    expect(tools.map((tool) => tool.name)).toEqual(["loan_payoff"]);
    expect(tools[0]?.capabilityId).toBe("loan-payoff");
    await createIcasMcpServer(registry);
  });
});
