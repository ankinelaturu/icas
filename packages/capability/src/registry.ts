/**
 * @file CapabilityRegistry — catalog CRUD for base capabilities (overrides land in Pass 1.6).
 */

import type { CapabilityArtifact } from "./artifact.js";

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
}
