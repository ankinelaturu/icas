/**
 * @file CapabilityValidationError and validateCapabilityArtifact.
 */

import { z } from "zod";

import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
} from "./artifact-schema.js";

/**
 * Thrown when capability JSON does not match the artifact schema.
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
