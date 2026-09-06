/**
 * @file load-repo-env — fill empty process.env keys from a repo-root `.env`.
 *
 * Same helper as icas-agent / icas-play. `pnpm --filter … exec` drops
 * `ICAS_*_LLM_API_KEY`; `icas-adapt` still needs `ICAS_ADAPT_LLM_*`.
 * Non-empty exports are left alone. Tests pass `startDir` and never search
 * the real repo.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load `.env` into `process.env` for keys that are missing or empty.
 *
 * @param startDir - Test-only root; production omits this
 * @returns The path that was applied, or `undefined` if none existed
 */
export function loadRepoEnv(startDir?: string): string | undefined {
  const roots =
    startDir === undefined
      ? [process.cwd(), dirname(fileURLToPath(import.meta.url))]
      : [startDir];
  for (const root of roots) {
    const envPath = findUp(root, ".env");
    if (envPath === undefined) {
      continue;
    }
    applyDotEnvFile(envPath);
    return envPath;
  }
  return undefined;
}

/**
 * Walk `dir` and its parents for a file named `name`.
 *
 * @param dir - Start directory
 * @param name - Basename, usually `.env`
 * @returns Absolute path, or `undefined` at the filesystem root
 */
function findUp(dir: string, name: string): string | undefined {
  let current = dir;
  for (;;) {
    const candidate = join(current, name);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Parse KEY=VALUE lines. Skip comments. Do not clobber non-empty env vars.
 *
 * @param envPath - Absolute path to `.env`
 */
function applyDotEnvFile(envPath: string): void {
  const text = readFileSync(envPath, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    const current = process.env[key];
    if (current !== undefined && current.length > 0) {
      continue;
    }
    process.env[key] = unquote(body.slice(eq + 1).trim());
  }
}

/**
 * Strip one matching pair of quotes. Inner escapes are not processed.
 *
 * @param value - Raw right-hand side
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const start = value[0];
    const end = value[value.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
