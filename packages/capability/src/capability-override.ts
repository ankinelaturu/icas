/**
 * @file Tenant override types — declarative patches on a version-pinned base capability.
 */

import type {
  Assertion,
  CapabilityAction,
  CapabilityStep,
  TargetDescriptor,
} from "./artifact.js";

/**
 * Who wrote the override file.
 *
 * - `discovery` — header-only enrollment of the discovering tenant
 * - `verified` — header-only enrollment after a compatible adapt run
 * - `icas-adapt` — declarative patch generated from drift
 * - `human` — operator-authored patch
 */
export type OverrideProvenanceCreatedBy =
  | "discovery"
  | "verified"
  | "icas-adapt"
  | "human";

/**
 * Why this tenant override exists and which run produced it.
 */
export interface OverrideProvenance {
  createdBy: OverrideProvenanceCreatedBy;
  createdFromRun?: string;
  reason: string;
}

/**
 * Patch one existing step by id.
 *
 * Supply `step` to replace the whole step. Otherwise replace only the fields
 * that are present (`target`, `action`, `preconditions`, `postconditions`).
 * Combining `step` with field-level patches is rejected at validation time.
 */
export interface StepOverride {
  step?: CapabilityStep;
  target?: TargetDescriptor;
  action?: CapabilityAction;
  preconditions?: Assertion[];
  postconditions?: Assertion[];
}

/**
 * Declarative operations applied to a base capability. An empty object is a
 * valid header-only enrollment.
 */
export interface CapabilityOverridePatch {
  steps?: Record<string, StepOverride>;
  insertBefore?: Record<string, CapabilityStep[]>;
  insertAfter?: Record<string, CapabilityStep[]>;
  disabledSteps?: string[];
}

/**
 * Tenant specialization of a pinned base capability version.
 *
 * Keyed in the catalog by `(target.tenant, baseCapability)`. `baseCapability`
 * is `id@version`, for example `loan-payoff@1.0.0`.
 */
export interface CapabilityOverride {
  schemaVersion: string;
  id: string;
  baseCapability: string;
  target: { tenant: string };
  overrides: CapabilityOverridePatch;
  provenance: OverrideProvenance;
}
