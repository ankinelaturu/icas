/**
 * @file Primitive value checks and ValueRef resolution against an input map.
 *
 * Replay uses these after the artifact schema has already passed. Schema
 * checks shape; this module checks runtime values (ISO dates, money, missing
 * required keys) so a typed invocation cannot smuggle the wrong primitive.
 */

import type { CapabilityArtifact, PrimitiveType, ValueRef } from "./artifact.js";

/**
 * Thrown when a value does not match a declared primitive type, or a ValueRef
 * cannot be resolved.
 */
export class CapabilityTypeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CapabilityTypeError";
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Return true when `value` is a real calendar date in `YYYY-MM-DD` form.
 *
 * Reconstruct a UTC date and compare components so `2026-02-31` is rejected.
 * `Date.parse` would roll that forward to March.
 */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Check that `value` matches the declared primitive `type`.
 *
 * `date` is a calendar string, not a `Date` object, so JSON round-trips.
 * `money` accepts a finite number or a decimal string — computed amounts vs
 * catalog literals that must not become IEEE floats.
 *
 * @throws {CapabilityTypeError} When the runtime type does not match
 */
export function validatePrimitiveValue(
  type: PrimitiveType,
  value: unknown,
): void {
  switch (type) {
    case "string":
      if (typeof value !== "string") {
        throw new CapabilityTypeError(`expected string, got ${describe(value)}`);
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CapabilityTypeError(`expected finite number, got ${describe(value)}`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new CapabilityTypeError(`expected boolean, got ${describe(value)}`);
      }
      return;
    case "date":
      if (typeof value !== "string" || !isIsoDate(value)) {
        throw new CapabilityTypeError(
          `expected ISO date YYYY-MM-DD, got ${describe(value)}`,
        );
      }
      return;
    case "money":
      if (typeof value === "number" && Number.isFinite(value)) {
        return;
      }
      if (typeof value === "string" && MONEY_STRING.test(value)) {
        return;
      }
      throw new CapabilityTypeError(
        `expected money (finite number or decimal string), got ${describe(value)}`,
      );
    default: {
      const exhaustive: never = type;
      throw new CapabilityTypeError(`unknown primitive type ${String(exhaustive)}`);
    }
  }
}

/**
 * Check every provided input against the capability's declared input types.
 *
 * Unknown keys fail first so a typo is not silently ignored. Optional declared
 * keys may be absent; required keys may not. Type-check only values that are
 * present so an optional input does not demand `undefined` match a primitive.
 *
 * @throws {CapabilityTypeError} On missing required keys, unknown keys, or type mismatch
 */
export function validateInputValues(
  declared: CapabilityArtifact["inputs"],
  values: Readonly<Record<string, unknown>>,
): void {
  for (const name of Object.keys(values)) {
    if (!(name in declared)) {
      throw new CapabilityTypeError(`unknown input "${name}"`);
    }
  }
  for (const [name, spec] of Object.entries(declared)) {
    const present = Object.hasOwn(values, name);
    if (spec.required === true && !present) {
      throw new CapabilityTypeError(`missing required input "${name}"`);
    }
    if (!present) {
      continue;
    }
    try {
      validatePrimitiveValue(spec.type, values[name]);
    } catch (error) {
      throw new CapabilityTypeError(
        `input "${name}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

/**
 * Check extracted outputs against the capability's declared output types.
 *
 * Unlike inputs, every declared output must be present — this is the success
 * contract, not an invocation form. Unknown keys still fail so extra extract
 * noise cannot pass as a complete result.
 *
 * @throws {CapabilityTypeError} On missing declared keys, unknown keys, or type mismatch
 */
export function validateOutputValues(
  declared: CapabilityArtifact["outputs"],
  values: Readonly<Record<string, unknown>>,
): void {
  for (const name of Object.keys(values)) {
    if (!(name in declared)) {
      throw new CapabilityTypeError(`unknown output "${name}"`);
    }
  }
  for (const [name, spec] of Object.entries(declared)) {
    if (!Object.hasOwn(values, name)) {
      throw new CapabilityTypeError(`missing output "${name}"`);
    }
    try {
      validatePrimitiveValue(spec.type, values[name]);
    } catch (error) {
      throw new CapabilityTypeError(
        `output "${name}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

/**
 * Return the concrete value for a ValueRef from `inputs` or the literal.
 *
 * Runtime XOR mirrors the schema refine: mixed or empty refs fail here too in
 * case a caller built a ValueRef in code without going through Zod. A missing
 * input name throws rather than returning `undefined` (that would look like a
 * successful empty fill).
 *
 * @param ref - Exactly one of `input` or `literal`
 * @param inputs - Invocation parameter map
 * @returns The referenced input value or the literal
 * @throws {CapabilityTypeError} When the ref is empty, mixed, or the input name is missing
 */
export function resolveValueRef(
  ref: ValueRef,
  inputs: Readonly<Record<string, unknown>>,
): unknown {
  const hasInput = ref.input !== undefined;
  const hasLiteral = ref.literal !== undefined;
  if (hasInput === hasLiteral) {
    throw new CapabilityTypeError(
      "ValueRef must have exactly one of input or literal",
    );
  }
  if (ref.input !== undefined) {
    if (!Object.hasOwn(inputs, ref.input)) {
      throw new CapabilityTypeError(`missing input "${ref.input}" for ValueRef`);
    }
    return inputs[ref.input];
  }
  return ref.literal;
}

/**
 * Human-readable type tag for error messages.
 *
 * Quote strings so an empty `""` is visible; other values use `typeof`.
 */
function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return typeof value;
}
