/**
 * @file loadPromptPolicy — load injectable discovery safety text from markdown.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_POLICY_FILE = "default-policy.md";

/**
 * Path to the packaged default prompt policy markdown.
 */
export function defaultPromptPolicyPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../prompts", DEFAULT_POLICY_FILE);
}

/**
 * Resolve which markdown file to load.
 *
 * Order: explicit `path`, then `ICAS_PROMPT_POLICY`, then the packaged default.
 */
export function resolvePromptPolicyPath(path?: string): string {
  const fromEnv = process.env.ICAS_PROMPT_POLICY;
  const chosen = path ?? (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : defaultPromptPolicyPath());
  if (isAbsolute(chosen)) {
    return chosen;
  }
  return join(process.cwd(), chosen);
}

/**
 * Load prompt-policy markdown for injection into the discovery agent.
 *
 * @param path - Optional file path; overrides `ICAS_PROMPT_POLICY`
 * @returns File contents
 * @throws {Error} When the file cannot be read
 */
export async function loadPromptPolicy(path?: string): Promise<string> {
  const resolved = resolvePromptPolicyPath(path);
  try {
    return await readFile(resolved, "utf8");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`prompt policy file not found: ${resolved} (${cause})`);
  }
}
