/**
 * @file @icas/capability — artifact schema, catalog, tenant overrides, and resolve.
 */

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

export type { CapabilityRegistry, CapabilitySummary } from "./registry.js";
export { FileSystemCapabilityRegistry } from "./filesystem-capability-registry.js";
export type { FileSystemCapabilityRegistryOptions } from "./filesystem-capability-registry.js";
export {
  assertCatalogId,
  assertCatalogVersion,
  compareCapabilityVersion,
  parseBaseCapabilityPin,
} from "./catalog-ids.js";

export { applyCapabilityOverride } from "./apply-override.js";
export {
  CapabilityResolveError,
  CapabilityResolver,
} from "./capability-resolver.js";
export type { ResolveCapabilityQuery } from "./capability-resolver.js";
