/**
 * @file validateCapabilityOverride — schema-validate a tenant override JSON value.
 *
 * Gate for every override write and disk read. Invalid patches must not enroll
 * a tenant. `safeParse` plus a typed error keeps Zod's issue list (version pin,
 * executable keys, empty StepOverride) for callers.
 */

import { z } from "zod";

import {
  CapabilityOverrideSchema,
  type CapabilityOverride,
} from "./override-schema.js";

/**
 * Thrown when override JSON is not a declarative, version-pinned patch.
 *
 * Distinct from {@link CapabilityValidationError}: this is the tenant file,
 * not the Vendor+Product base.
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
 * Header-only `overrides: {}` parses successfully — that is enrollment, not a
 * schema error. Executable keys and a missing version pin still fail.
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
