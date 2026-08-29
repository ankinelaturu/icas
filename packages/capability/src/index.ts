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

export type {
  CapabilityOverride,
  CapabilityOverridePatch,
  OverrideProvenance,
  OverrideProvenanceCreatedBy,
  StepOverride,
} from "./capability-override.js";

/**
 * Catalog of capability artifacts. Pass 1.5 replaces this scaffold with the
 * full registry API from `docs/04-capability-artifact.md`.
 */
export interface CapabilityRegistry {
  list(): Promise<CapabilityArtifact[]>;
  get(id: string): Promise<CapabilityArtifact | undefined>;
  save(capability: CapabilityArtifact): Promise<void>;
}
