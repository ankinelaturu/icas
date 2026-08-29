/**
 * @file CapabilityRegistry — catalog CRUD for base capabilities and tenant overrides.
 */

import type { CapabilityArtifact } from "./artifact.js";
import type { CapabilityOverride } from "./capability-override.js";

/**
 * Latest-version listing row for catalog UIs.
 */
export interface CapabilitySummary {
  id: string;
  name: string;
  capabilityVersion: string;
  schemaVersion: string;
  target: { vendor: string; product: string };
}

/**
 * Abstract catalog of capability artifacts. Callers depend on this interface,
 * not on filesystem paths.
 */
export interface CapabilityRegistry {
  /**
   * List the latest `capabilityVersion` per id.
   *
   * @param filter - Optional Vendor+Product match on `target`
   */
  list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]>;

  /**
   * Load the latest capability version for `id`, or a specific version when given.
   *
   * @returns The artifact, or `undefined` if it is not in the catalog
   */
  get(id: string, version?: string): Promise<CapabilityArtifact | undefined>;

  /**
   * Validate and upsert a base capability keyed by `(id, capabilityVersion)`.
   *
   * @throws {CapabilityValidationError} When the artifact is invalid
   */
  save(capability: CapabilityArtifact): Promise<void>;

  /**
   * Remove one version, or every version of `id` when `version` is omitted.
   *
   * @returns `true` when at least one file was removed
   */
  remove(id: string, version?: string): Promise<boolean>;

  /**
   * List stored tenant overrides, optionally filtered by tenant and/or pin.
   */
  listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string;
  }): Promise<CapabilityOverride[]>;

  /**
   * Load the override for one enrolled tenant and pinned base version.
   */
  getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined>;

  /**
   * Validate and upsert a tenant override. The pinned base version must already
   * be stored. Header-only `overrides: {}` is valid.
   *
   * @throws {CapabilityOverrideValidationError} When the override is invalid
   * @throws {Error} When the pinned base version is not in the catalog
   */
  saveOverride(override: CapabilityOverride): Promise<void>;

  /**
   * Remove one tenant override.
   *
   * @returns `true` when a file was removed
   */
  removeOverride(tenant: string, baseCapability: string): Promise<boolean>;
}
