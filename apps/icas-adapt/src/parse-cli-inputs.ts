/**
 * @file Parse typed capability inputs from leftover CLI tokens.
 *
 * Commander owns identity flags (`--url`, `--tenant`, …). Remaining
 * `--loanAccountId 123` and `--input name=value` pairs become the invocation
 * map. `--url` is never an input name and never a tenant id.
 */

/** Flags Commander already parsed. Must not become capability inputs. */
const RESERVED_FLAGS = new Set([
  "url",
  "tenant",
  "vendor",
  "product",
  "version",
  "headless",
  "headed",
  "assist",
  "help",
]);

/** Boolean flags consume no following value. */
const BOOLEAN_FLAGS = new Set(["headless", "headed", "assist", "help"]);

/**
 * Collect leftover `--name value` / `--input name=value` tokens.
 *
 * @param tokens - Unknown options after Commander parsed reserved flags
 * @returns Raw string map; callers coerce against the artifact input schema
 * @throws {Error} When a flag is missing a value or `--input` lacks `name=value`
 */
export function parseCapabilityInputFlags(tokens: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith("--")) {
      // Positional leftovers are not typed inputs; ignore rather than guess.
      continue;
    }
    const body = token.slice(2);
    if (body.includes("=")) {
      const eq = body.indexOf("=");
      const key = body.slice(0, eq);
      const value = body.slice(eq + 1);
      assignFlag(values, key, value);
      continue;
    }
    if (BOOLEAN_FLAGS.has(body) || RESERVED_FLAGS.has(body)) {
      // `--assist` is reserved for a later pass; do not treat it as an input.
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`flag --${body} requires a value`);
    }
    assignFlag(values, body, next);
    index += 1;
  }
  return values;
}

/**
 * Apply one flag. `--input` splits on the first `=` so values may contain `=`.
 *
 * @param values - Accumulator
 * @param key - Flag name without `--`
 * @param value - Raw CLI string
 */
function assignFlag(
  values: Record<string, string>,
  key: string,
  value: string,
): void {
  if (RESERVED_FLAGS.has(key) && key !== "input") {
    return;
  }
  if (key === "input") {
    const eq = value.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--input must be name=value, got "${value}"`);
    }
    const name = value.slice(0, eq);
    values[name] = value.slice(eq + 1);
    return;
  }
  values[key] = value;
}
