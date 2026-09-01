/**
 * @file Artifact types inferred from the Zod capability schema.
 *
 * Keep types on this barrel so callers import data shapes without pulling Zod.
 * Runtime validation stays in `artifact-schema.ts`; this module never parses JSON.
 *
 * @see CapabilityArtifactSchema
 */

export type {
  Assertion,
  CapabilityAction,
  CapabilityArtifact,
  CapabilityStep,
  OutcomeMatch,
  PossibleOutcome,
  PrimitiveType,
  TargetDescriptor,
  ValueRef,
} from "./artifact-schema.js";
