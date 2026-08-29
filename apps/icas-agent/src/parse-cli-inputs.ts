/**
 * @file Parse `--input name=value` for discovery-time parameterization.
 *
 * These values become `{ input: name }` on matching fill/select literals.
 * `--url` is never an input name.
 */

const RESERVED_FLAGS = new Set([
  "id",
  "url",
  "goal",
  "tenant",
  "vendor",
  "product",
  "name",
  "capability-version",
  "headless",
  "help",
]);

const BOOLEAN_FLAGS = new Set(["headless", "help"]);

/**
 * Collect leftover `--name value` / `--input name=value` tokens.
 *
 * @param tokens - Unknown options after Commander parsed reserved flags
 */
export function parseCapabilityInputFlags(tokens: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith("--")) {
      continue;
    }
    const body = token.slice(2);
    if (body.includes("=")) {
      const eq = body.indexOf("=");
      const key = body.slice(0, eq);
      assignFlag(values, key, body.slice(eq + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(body) || RESERVED_FLAGS.has(body)) {
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
    values[value.slice(0, eq)] = value.slice(eq + 1);
    return;
  }
  values[key] = value;
}
