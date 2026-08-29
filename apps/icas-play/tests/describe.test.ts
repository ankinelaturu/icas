/**
 * @file icas-play describe is reviewable without opening JSON.
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

import { runPlay } from "../src/cli.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff() {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

describe("icas-play describe", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  const lines: string[] = [];
  const errors: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-play-desc-"));
    registry = new FileSystemCapabilityRegistry({ root });
    lines.length = 0;
    errors.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints inputs, outputs, steps, success, and discoveredOn", async () => {
    await registry.save(loadLoanPayoff());
    await runPlay(["node", "icas-play", "describe", "loan-payoff"], {
      registry,
      stdout: (line) => {
        lines.push(line);
      },
    });
    const text = lines.join("\n");
    expect(text).toContain("id: loan-payoff");
    expect(text).toContain("loanAccountId: string (required)");
    expect(text).toContain("totalPayoffAmount: money");
    expect(text).toContain("open-lending:");
    expect(text).toContain("success:");
    expect(text).toContain("discoveredOn: tenant=icas-bank");
    expect(text).not.toContain('"schemaVersion"');
  });

  it("fails when the id is missing", async () => {
    await runPlay(["node", "icas-play", "describe", "missing"], {
      registry,
      stdout: (line) => {
        lines.push(line);
      },
      stderr: (line) => {
        errors.push(line);
      },
    });
    expect(errors.join("\n")).toMatch(/not in the catalog/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
