/**
 * @file CapabilityRegistry — catalog CRUD for base capabilities and tenant overrides.
 *
 * Abstract catalog API. Apps, {@link CapabilityResolver}, and tests depend on
 * this interface, not on filesystem paths. The only backend in this repo is
 * {@link FileSystemCapabilityRegistry}. REST/DB registries are out of scope.
 *
 * Enrollment is fail-closed: `getOverride` returns `undefined` when the tenant
 * file is missing, and resolve must not treat that as "use the bare base".
 */

import type { CapabilityArtifact } from "./artifact.js";
import type { CapabilityOverride } from "./capability-override.js";

/**
 * Latest-version listing row for catalog UIs.
 *
 * `list` returns one row per id (the newest `capabilityVersion`). Describe and
 * MCP catalog tools consume this; they do not glob JSON files.
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
 *
 * On-disk layout (filesystem backend): `<root>/<id>/<version>.json` for the
 * Vendor+Product base and `<root>/<id>/overrides/<tenant>.json` for enrollment.
 * Tenant identity is never in the base filename.
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
   * Missing is `undefined`, not a throw, so list/describe can skip empty dirs.
   * Resolve maps that `undefined` to {@link CapabilityResolveError}.
   *
   * @returns The artifact, or `undefined` if it is not in the catalog
   */
  get(id: string, version?: string): Promise<CapabilityArtifact | undefined>;

  /**
   * Validate and upsert a base capability keyed by `(id, capabilityVersion)`.
   *
   * Invalid artifacts must not be written. This is the Vendor+Product base,
   * not a per-tenant copy.
   *
   * @throws {CapabilityValidationError} When the artifact is invalid
   */
  save(capability: CapabilityArtifact): Promise<void>;

  /**
   * Remove one version, or every version of `id` when `version` is omitted.
   *
   * Omitting `version` removes the id directory, including tenant overrides.
   *
   * @returns `true` when at least one file was removed
   */
  remove(id: string, version?: string): Promise<boolean>;

  /**
   * List stored tenant overrides, optionally filtered by tenant and/or pin.
   *
   * A tenant with no file is not enrolled. Callers that need fail-closed
   * replay go through {@link CapabilityResolver}, not this list alone.
   */
  listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string;
  }): Promise<CapabilityOverride[]>;

  /**
   * Load the override for one enrolled tenant and pinned base version.
   *
   * Missing file or pin mismatch returns `undefined`. Do not treat that as
   * permission to replay the bare base — resolve throws instead.
   */
  getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined>;

  /**
   * Validate and upsert a tenant override. The pinned base version must already
   * be stored. Header-only `overrides: {}` is valid.
   *
   * Header-only enrolls the tenant so later edits do not patch `1.0.0.json`.
   * Refuse if the pin's base is not stored — enrollment cannot point at a
   * missing `capabilityVersion`.
   *
   * @throws {CapabilityOverrideValidationError} When the override is invalid
   * @throws {Error} When the pinned base version is not in the catalog
   */
  saveOverride(override: CapabilityOverride): Promise<void>;

  /**
   * Remove one tenant override.
   *
   * After this, the tenant is not enrolled for that pin. Replay must fail
   * closed until a new override is saved.
   *
   * @returns `true` when a file was removed
   */
  removeOverride(tenant: string, baseCapability: string): Promise<boolean>;
}
