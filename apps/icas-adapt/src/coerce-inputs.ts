/**
 * @file Coerce CLI strings into artifact primitive types before validateInputValues.
 */

import type { CapabilityArtifact, PrimitiveType } from "@icas/capability";
import { CapabilityTypeError } from "@icas/capability";

/**
 * Convert raw CLI strings using each declared input's primitive type.
 *
 * Unknown names stay strings so {@link validateInputValues} can report them.
 *
 * @param declared - Capability `inputs` map
 * @param raw - Parsed `--name value` strings
 */
export function coerceInputValues(
  declared: CapabilityArtifact["inputs"],
  raw: Record<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(raw)) {
    const spec = declared[name];
    if (spec === undefined) {
      values[name] = text;
      continue;
    }
    values[name] = coercePrimitive(spec.type, text, name);
  }
  return values;
}

/**
 * Parse one CLI string as the declared primitive.
 *
 * @param type - Artifact primitive
 * @param text - Operator-supplied string
 * @param name - Input name for error messages
 */
function coercePrimitive(type: PrimitiveType, text: string, name: string): unknown {
  switch (type) {
    case "string":
    case "date":
    case "money":
      // date/money stay strings so JSON round-trips match discovery artifacts.
      return text;
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        throw new CapabilityTypeError(`input "${name}": expected finite number, got ${text}`);
      }
      return parsed;
    }
    case "boolean": {
      if (text === "true" || text === "1") {
        return true;
      }
      if (text === "false" || text === "0") {
        return false;
      }
      throw new CapabilityTypeError(
        `input "${name}": expected true/false, got ${text}`,
      );
    }
    default: {
      const exhaustive: never = type;
      throw new CapabilityTypeError(`unknown primitive type ${String(exhaustive)}`);
    }
  }
}
