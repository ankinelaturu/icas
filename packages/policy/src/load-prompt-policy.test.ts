import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultPromptPolicyPath,
  loadPromptPolicy,
} from "./load-prompt-policy.js";

describe("loadPromptPolicy", () => {
  const previous = process.env.ICAS_PROMPT_POLICY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ICAS_PROMPT_POLICY;
    } else {
      process.env.ICAS_PROMPT_POLICY = previous;
    }
  });

  it("loads the packaged default policy markdown", async () => {
    delete process.env.ICAS_PROMPT_POLICY;
    const text = await loadPromptPolicy();
    expect(text).toMatch(/Allowed behavior/);
    expect(text).toMatch(/transfer funds/);
    expect(defaultPromptPolicyPath()).toMatch(/default-policy\.md$/);
  });

  it("honors ICAS_PROMPT_POLICY", async () => {
    const dir = join(tmpdir(), `icas-policy-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const custom = join(dir, "custom.md");
    await writeFile(custom, "# custom tenant policy\n", "utf8");
    process.env.ICAS_PROMPT_POLICY = custom;
    await expect(loadPromptPolicy()).resolves.toMatch(/custom tenant policy/);
    await rm(dir, { recursive: true, force: true });
  });

  it("errors clearly when the path is missing", async () => {
    await expect(
      loadPromptPolicy("/does/not/exist/icas-policy.md"),
    ).rejects.toThrow(/prompt policy file not found/);
  });
});
