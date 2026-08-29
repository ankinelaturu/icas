/**
 * @file loadPromptPolicy — load injectable discovery safety text from markdown.
 *
 * This text influences what the model proposes. It does not enforce execution;
 * {@link PolicyGuard} still allow / deny / require-human every action.
 *
 * @see PolicyGuard
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_POLICY_FILE = "default-policy.md";

/**
 * Path to the packaged default prompt policy markdown.
 *
 * Resolved from this module so the default travels with the package rather
 * than depending on the caller's working directory.
 *
 * @returns Absolute path under `packages/policy/prompts/`
 */
export function defaultPromptPolicyPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../prompts", DEFAULT_POLICY_FILE);
}

/**
 * Resolve which markdown file to load.
 *
 * Order: explicit `path`, then `ICAS_PROMPT_POLICY`, then the packaged default.
 * Relative paths join `process.cwd()` so a CLI flag works from the repo root
 * without recompiling. An env override lets a tenant swap text without a rebuild.
 *
 * @param path - Optional file path; wins over `ICAS_PROMPT_POLICY`
 * @returns Absolute path of the markdown to read
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
 * Callers pass the string into Mastra instructions. Missing files fail loudly
 * so discovery never runs with an empty "policy" by accident.
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
