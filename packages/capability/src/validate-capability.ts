/**
 * @file CapabilityValidationError and validateCapabilityArtifact.
 *
 * Gate for every catalog write and for resolve's effective artifact. Invalid
 * JSON must not reach replay. `safeParse` plus a typed error keeps Zod's
 * issue list for callers; a thrown `ZodError` would lose that wrapping.
 */

import { z } from "zod";

import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
} from "./artifact-schema.js";

/**
 * Thrown when capability JSON does not match the artifact schema.
 *
 * `issues` is the raw Zod list so tests and CLIs can pin a path (duplicate
 * step id, unknown action `type`) without scraping the pretty message.
 */
export class CapabilityValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(error: z.ZodError) {
    super(`Invalid capability artifact: ${z.prettifyError(error)}`);
    this.name = "CapabilityValidationError";
    this.issues = error.issues;
  }
}

/**
 * Schema-validate unknown JSON as a base capability artifact.
 *
 * Call this on disk reads and before `save`. Resolve also re-validates the
 * merged effective artifact so a patch cannot introduce an invalid step.
 *
 * @param value - Parsed JSON (not a file path)
 * @returns The typed artifact
 * @throws {CapabilityValidationError} When required fields, versions, actions, or assertions are invalid
 */
export function validateCapabilityArtifact(
  value: unknown,
): CapabilityArtifact {
  const result = CapabilityArtifactSchema.safeParse(value);
  if (!result.success) {
    throw new CapabilityValidationError(result.error);
  }
  return result.data;
}
