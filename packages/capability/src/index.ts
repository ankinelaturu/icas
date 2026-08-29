/**
 * @file @icas/capability — artifact schema, catalog, tenant overrides, and resolve.
 */

import type { CapabilityArtifact } from "./artifact.js";

export type {
  Assertion,
  CapabilityAction,
  CapabilityArtifact,
  CapabilityStep,
  PrimitiveType,
  TargetDescriptor,
  ValueRef,
} from "./artifact.js";

export {
  AssertionSchema,
  CapabilityActionSchema,
  CapabilityArtifactSchema,
  CapabilityStepSchema,
  TargetDescriptorSchema,
  ValueRefSchema,
} from "./artifact-schema.js";

export type {
  CapabilityOverride,
  CapabilityOverridePatch,
  OverrideProvenance,
  OverrideProvenanceCreatedBy,
  StepOverride,
} from "./capability-override.js";

export {
  CapabilityOverridePatchSchema,
  CapabilityOverrideSchema,
  OverrideProvenanceSchema,
  StepOverrideSchema,
} from "./override-schema.js";

export {
  CapabilityOverrideValidationError,
  validateCapabilityOverride,
} from "./validate-override.js";

export {
  CapabilityValidationError,
  validateCapabilityArtifact,
} from "./validate-capability.js";

export {
  CapabilityTypeError,
  resolveValueRef,
  validateInputValues,
  validateOutputValues,
  validatePrimitiveValue,
} from "./values.js";

/**
 * Catalog of capability artifacts. Pass 1.5 replaces this scaffold with the
 * full registry API from `docs/04-capability-artifact.md`.
 */
export interface CapabilityRegistry {
  list(): Promise<CapabilityArtifact[]>;
  get(id: string): Promise<CapabilityArtifact | undefined>;
  save(capability: CapabilityArtifact): Promise<void>;
}
