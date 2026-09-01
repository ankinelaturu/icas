/**
 * @file CapabilityRegistry — catalog CRUD for base capabilities and tenant overrides.
 *
 * Abstract catalog API. Apps, {@link CapabilityResolver}, and tests depend on
 * this interface, not on filesystem paths. The only backend in this repo is
 * {@link FileSystemCapabilityRegistry}. REST/DB registries are out of scope.
 *
 * Enrollment is fail-closed: `getOverride` returns `undefined` when the tenant
 * file is missing, and resolve must not treat that as "use the bare base".
 * There is one base artifact per id. Tenant differences live on overrides.
 */

import type { CapabilityArtifact } from "./artifact.js";
import type { CapabilityOverride } from "./capability-override.js";

/**
 * Listing row for catalog UIs.
 *
 * `list` returns one row per id. Describe and MCP catalog tools consume this;
 * they do not glob JSON files.
 */
export interface CapabilitySummary {
  id: string;
  name: string;
  schemaVersion: string;
  target: { vendor: string; product: string };
}

/**
 * Abstract catalog of capability artifacts. Callers depend on this interface,
 * not on filesystem paths.
 *
 * On-disk layout (filesystem backend): `<root>/<id>/capability.json` for the
 * Vendor+Product base and `<root>/<id>/overrides/<tenant>.json` for enrollment.
 * Tenant identity is never in the base filename.
 */
export interface CapabilityRegistry {
  /**
   * List one row per stored id.
   *
   * @param filter - Optional Vendor+Product match on `target`
   */
  list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]>;

  /**
   * Load the base capability for `id`.
   *
   * Missing is `undefined`, not a throw, so list/describe can skip empty dirs.
   * Resolve maps that `undefined` to {@link CapabilityResolveError}.
   *
   * @returns The artifact, or `undefined` if it is not in the catalog
   */
  get(id: string): Promise<CapabilityArtifact | undefined>;

  /**
   * Validate and upsert a base capability keyed by `id`.
   *
   * Invalid artifacts must not be written. This is the Vendor+Product base,
   * not a per-tenant copy.
   *
   * @throws {CapabilityValidationError} When the artifact is invalid
   */
  save(capability: CapabilityArtifact): Promise<void>;

  /**
   * Remove the id directory, including tenant overrides.
   *
   * @returns `true` when the directory was removed
   */
  remove(id: string): Promise<boolean>;

  /**
   * List stored tenant overrides, optionally filtered by tenant and/or base id.
   *
   * A tenant with no file is not enrolled. Callers that need fail-closed
   * replay go through {@link CapabilityResolver}, not this list alone.
   */
  listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string;
  }): Promise<CapabilityOverride[]>;

  /**
   * Load the override for one enrolled tenant and base id.
   *
   * Missing file or id mismatch returns `undefined`. Do not treat that as
   * permission to replay the bare base — resolve throws instead.
   */
  getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined>;

  /**
   * Validate and upsert a tenant override. The named base id must already
   * be stored. Header-only `overrides: {}` is valid.
   *
   * Header-only enrolls the tenant so later edits do not patch `capability.json`.
   * Refuse if the base is not stored.
   *
   * @throws {CapabilityOverrideValidationError} When the override is invalid
   * @throws {Error} When the named base is not in the catalog
   */
  saveOverride(override: CapabilityOverride): Promise<void>;

  /**
   * Remove one tenant override.
   *
   * After this, the tenant is not enrolled for that id. Replay must fail
   * closed until a new override is saved.
   *
   * @returns `true` when a file was removed
   */
  removeOverride(tenant: string, baseCapability: string): Promise<boolean>;
}
