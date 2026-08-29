import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSystemCapabilityRegistry } from "./filesystem-capability-registry.js";
import {
  CapabilityValidationError,
  validateCapabilityArtifact,
} from "./validate-capability.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadLoanPayoff(): ReturnType<typeof validateCapabilityArtifact> {
  const raw = readFileSync(
    join(repoRoot, "tests/fixtures/loan-payoff.capability.json"),
    "utf8",
  );
  return validateCapabilityArtifact(JSON.parse(raw) as unknown);
}

describe("FileSystemCapabilityRegistry", () => {
  let root: string;
  let registry: FileSystemCapabilityRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "icas-capability-"));
    registry = new FileSystemCapabilityRegistry({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips a saved capability from a temp directory", async () => {
    const artifact = loadLoanPayoff();
    await registry.save(artifact);
    const loaded = await registry.get("loan-payoff");
    expect(loaded).toEqual(artifact);
  });

  it("lists the latest version per id", async () => {
    const artifact = loadLoanPayoff();
    await registry.save(artifact);
    await registry.save({ ...artifact, capabilityVersion: "1.1.0", name: "Newer" });
    const listed = await registry.list();
    expect(listed).toEqual([
      {
        id: "loan-payoff",
        name: "Newer",
        capabilityVersion: "1.1.0",
        schemaVersion: "1.0",
        target: { vendor: "icas", product: "icas" },
      },
    ]);
  });

  it("filters list by vendor and product", async () => {
    const artifact = loadLoanPayoff();
    await registry.save(artifact);
    expect(await registry.list({ vendor: "other" })).toEqual([]);
    expect(await registry.list({ vendor: "icas", product: "icas" })).toHaveLength(
      1,
    );
  });

  it("loads a specific version when given", async () => {
    const artifact = loadLoanPayoff();
    await registry.save(artifact);
    await registry.save({ ...artifact, capabilityVersion: "1.1.0" });
    const v100 = await registry.get("loan-payoff", "1.0.0");
    expect(v100?.capabilityVersion).toBe("1.0.0");
  });

  it("returns undefined for a missing id", async () => {
    expect(await registry.get("missing")).toBeUndefined();
  });

  it("does not write an invalid artifact", async () => {
    await expect(registry.save({ id: "broken" } as never)).rejects.toBeInstanceOf(
      CapabilityValidationError,
    );
    expect(await registry.list()).toEqual([]);
  });

  it("removes one version or every version of an id", async () => {
    const artifact = loadLoanPayoff();
    await registry.save(artifact);
    await registry.save({ ...artifact, capabilityVersion: "1.1.0" });
    expect(await registry.remove("loan-payoff", "1.0.0")).toBe(true);
    expect(await registry.get("loan-payoff", "1.0.0")).toBeUndefined();
    expect((await registry.get("loan-payoff"))?.capabilityVersion).toBe("1.1.0");
    expect(await registry.remove("loan-payoff")).toBe(true);
    expect(await registry.get("loan-payoff")).toBeUndefined();
    expect(await registry.remove("loan-payoff")).toBe(false);
  });
});
