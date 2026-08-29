/**
 * @file validateCapabilityOverride — schema-validate a tenant override JSON value.
 */

import { z } from "zod";

import {
  CapabilityOverrideSchema,
  type CapabilityOverride,
} from "./override-schema.js";

/**
 * Thrown when override JSON is not a declarative, version-pinned patch.
 */
export class CapabilityOverrideValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(error: z.ZodError) {
    super(`Invalid capability override: ${z.prettifyError(error)}`);
    this.name = "CapabilityOverrideValidationError";
    this.issues = error.issues;
  }
}

/**
 * Schema-validate unknown JSON as a tenant capability override.
 *
 * @param value - Parsed JSON (not a file path)
 * @returns The typed override
 * @throws {CapabilityOverrideValidationError} When the shape, version pin, or patch is invalid
 */
export function validateCapabilityOverride(
  value: unknown,
): CapabilityOverride {
  const result = CapabilityOverrideSchema.safeParse(value);
  if (!result.success) {
    throw new CapabilityOverrideValidationError(result.error);
  }
  return result.data;
}
