/**
 * @file Tenant override types inferred from the override Zod schema.
 *
 * Keep types on this barrel so callers import patch shapes without pulling Zod.
 * Runtime validation stays in `override-schema.ts`; this module never parses JSON.
 *
 * @see CapabilityOverrideSchema
 */

export type {
  CapabilityOverride,
  CapabilityOverridePatch,
  OverrideProvenance,
  OverrideProvenanceCreatedBy,
  StepOverride,
} from "./override-schema.js";
