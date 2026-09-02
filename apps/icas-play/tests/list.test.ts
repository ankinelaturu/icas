/**
 * @file icas-play list uses CapabilityRegistry, not a filesystem glob.
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

describe("icas-play list", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;
  const lines: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-play-"));
    registry = new FileSystemCapabilityRegistry({ root });
    lines.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints id, name, and Vendor+Product from the registry", async () => {
    await registry.save(loadLoanPayoff());
    await runPlay(["node", "icas-play", "list"], {
      registry,
      stdout: (line) => {
        lines.push(line);
      },
    });
    expect(lines[0]).toBe("id\tname\tvendor/product");
    expect(lines[1]).toBe(
      "loan-payoff\tGenerate Loan Payoff Statement\ticas-bank/icas-bank",
    );
  });

  it("prints a clear empty-catalog message", async () => {
    await runPlay(["node", "icas-play", "list"], {
      registry,
      stdout: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(["No capabilities in the catalog."]);
  });

  it("still parses list after the -- pnpm inserts before the subcommand", async () => {
    await runPlay(["node", "icas-play", "--", "list"], {
      registry,
      stdout: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(["No capabilities in the catalog."]);
  });
});
