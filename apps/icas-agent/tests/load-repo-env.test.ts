/**
 * @file loadRepoEnv fills empty process.env keys from a temp `.env` only.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRepoEnv } from "../src/load-repo-env.js";

const TEST_KEY = "ICAS_LOAD_REPO_ENV_TEST";

describe("loadRepoEnv", () => {
  let root: string;
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env[TEST_KEY];
    delete process.env[TEST_KEY];
    root = await mkdtemp(join(tmpdir(), "icas-load-env-"));
  });

  afterEach(async () => {
    if (previous === undefined) {
      delete process.env[TEST_KEY];
    } else {
      process.env[TEST_KEY] = previous;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("loads a missing key from .env under startDir", async () => {
    await writeFile(join(root, ".env"), `${TEST_KEY}=from-file\n`, "utf8");
    expect(loadRepoEnv(root)).toBe(join(root, ".env"));
    expect(process.env[TEST_KEY]).toBe("from-file");
  });

  it("does not override a non-empty export", async () => {
    process.env[TEST_KEY] = "from-shell";
    await writeFile(join(root, ".env"), `${TEST_KEY}=from-file\n`, "utf8");
    loadRepoEnv(root);
    expect(process.env[TEST_KEY]).toBe("from-shell");
  });

  it("fills an empty env var from the file", async () => {
    process.env[TEST_KEY] = "";
    await writeFile(join(root, ".env"), `${TEST_KEY}="quoted-value"\n`, "utf8");
    loadRepoEnv(root);
    expect(process.env[TEST_KEY]).toBe("quoted-value");
  });
});
