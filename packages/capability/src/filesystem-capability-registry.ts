/**
 * @file FileSystemCapabilityRegistry — filesystem catalog of base capability JSON files.
 *
 * Layout under the injectable `root` (production: repo `capabilities/`; tests:
 * a temp directory, never the submission catalog):
 *
 * ```
 * <root>/<id>/<version>.json           # Vendor+Product base
 * <root>/<id>/overrides/<tenant>.json  # one enrolled tenant, possibly header-only
 * ```
 *
 * Tenant identity is not in the base filename. A missing override file means
 * not enrolled — `getOverride` returns `undefined`; resolve fails closed
 * rather than replaying the bare base. Path segments go through
 * {@link assertCatalogId} so `../` cannot escape `root`.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CapabilityArtifact } from "./artifact.js";
import {
  assertCatalogId,
  assertCatalogVersion,
  compareCapabilityVersion,
  parseBaseCapabilityPin,
} from "./catalog-ids.js";
import type { CapabilityOverride } from "./capability-override.js";
import type { CapabilityRegistry, CapabilitySummary } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";
import { validateCapabilityOverride } from "./validate-override.js";

export interface FileSystemCapabilityRegistryOptions {
  /** Catalog root. Production is repo `capabilities/`; tests pass a temp directory. */
  root: string;
}

/**
 * Filesystem-backed {@link CapabilityRegistry}.
 * Layout: `<root>/<id>/<version>.json` and `<root>/<id>/overrides/<tenant>.json`.
 *
 * REST and database backends are intentionally absent. Inject `root` so unit
 * tests never write the submission catalog.
 */
export class FileSystemCapabilityRegistry implements CapabilityRegistry {
  private readonly root: string;

  /**
   * @param options.root - Catalog directory. Tests pass a temp path, never repo `capabilities/`.
   */
  constructor(options: FileSystemCapabilityRegistryOptions) {
    this.root = options.root;
  }

  /**
   * List the latest version per id, optionally filtered by Vendor+Product.
   *
   * Empty id directories (no valid `N.N.N.json`) are skipped. Sort by id so
   * catalog UIs stay stable across readdir order.
   */
  async list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]> {
    const ids = await this.readCapabilityIds();
    const summaries: CapabilitySummary[] = [];
    for (const id of ids) {
      const latest = await this.get(id);
      if (latest === undefined) {
        continue;
      }
      if (filter?.vendor !== undefined && latest.target.vendor !== filter.vendor) {
        continue;
      }
      if (
        filter?.product !== undefined &&
        latest.target.product !== filter.product
      ) {
        continue;
      }
      summaries.push({
        id: latest.id,
        name: latest.name,
        capabilityVersion: latest.capabilityVersion,
        schemaVersion: latest.schemaVersion,
        target: latest.target,
      });
    }
    summaries.sort((a, b) => a.id.localeCompare(b.id));
    return summaries;
  }

  /**
   * Load one artifact by id, or the latest version when `version` is omitted.
   *
   * Assert the id before joining paths. Missing file is `undefined`, not a
   * throw, so list can skip empty dirs. Corrupt JSON still throws — do not
   * treat parse failure as "not in catalog".
   */
  async get(
    id: string,
    version?: string,
  ): Promise<CapabilityArtifact | undefined> {
    const safeId = assertCatalogId(id);
    const resolvedVersion =
      version === undefined
        ? await this.latestVersion(safeId)
        : assertCatalogVersion(version);
    if (resolvedVersion === undefined) {
      return undefined;
    }
    const path = this.artifactPath(safeId, resolvedVersion);
    try {
      const raw = await readFile(path, "utf8");
      return validateCapabilityArtifact(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Schema-validate then upsert `<root>/<id>/<version>.json`.
   *
   * Validate first so invalid artifacts never land on disk. Pretty-print with
   * a trailing newline so git diffs stay reviewable.
   */
  async save(capability: CapabilityArtifact): Promise<void> {
    const valid = validateCapabilityArtifact(capability);
    const id = assertCatalogId(valid.id);
    const version = assertCatalogVersion(valid.capabilityVersion);
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true });
    const json = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(this.artifactPath(id, version), json, "utf8");
  }

  /**
   * Remove one version file, or the whole id directory when `version` is omitted.
   *
   * Omitting version also deletes `overrides/` — that unenrolls every tenant
   * for this id. `force: false` so a missing dir is `false`, not a silent ok.
   */
  async remove(id: string, version?: string): Promise<boolean> {
    const safeId = assertCatalogId(id);
    if (version === undefined) {
      const dir = join(this.root, safeId);
      try {
        await rm(dir, { recursive: true, force: false });
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw error;
      }
    }
    const safeVersion = assertCatalogVersion(version);
    const path = this.artifactPath(safeId, safeVersion);
    try {
      await rm(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Scan `<id>/overrides/*.json` across catalog ids.
   *
   * A missing `overrides/` directory is "no tenants enrolled", not an error.
   * Skip non-`.json` entries so a stray `.DS_Store` cannot become a tenant.
   */
  async listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string;
  }): Promise<CapabilityOverride[]> {
    const ids = await this.readCapabilityIds();
    const found: CapabilityOverride[] = [];
    for (const id of ids) {
      const dir = join(this.root, id, "overrides");
      let files: string[];
      try {
        files = await readdir(dir);
      } catch (error) {
        if (isNotFound(error)) {
          continue;
        }
        throw error;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const tenant = file.slice(0, -".json".length);
        const override = await this.readOverrideFile(id, tenant);
        if (override === undefined) {
          continue;
        }
        if (filter?.tenant !== undefined && override.target.tenant !== filter.tenant) {
          continue;
        }
        if (
          filter?.baseCapability !== undefined &&
          override.baseCapability !== filter.baseCapability
        ) {
          continue;
        }
        found.push(override);
      }
    }
    return found;
  }

  /**
   * Load one tenant override pinned to an exact `id@version`.
   *
   * Fail closed on pin mismatch: a file for `loan-payoff@1.0.0` must not be
   * returned when the caller asked for `loan-payoff@2.0.0`. Missing file is
   * `undefined` (not enrolled).
   */
  async getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined> {
    const pin = parseBaseCapabilityPin(baseCapability);
    const override = await this.readOverrideFile(pin.id, tenant);
    if (override === undefined) {
      return undefined;
    }
    if (override.baseCapability !== baseCapability) {
      return undefined;
    }
    return override;
  }

  /**
   * Schema-validate then upsert `<root>/<id>/overrides/<tenant>.json`.
   *
   * Refuse when the pinned base version is not stored — enrollment cannot
   * point at a missing `capabilityVersion`. Header-only `overrides: {}` is a
   * valid write; that is how first discover enrolls the discovering tenant.
   */
  async saveOverride(override: CapabilityOverride): Promise<void> {
    const valid = validateCapabilityOverride(override);
    const pin = parseBaseCapabilityPin(valid.baseCapability);
    const tenant = assertCatalogId(valid.target.tenant);
    const base = await this.get(pin.id, pin.version);
    if (base === undefined) {
      throw new Error(
        `pinned base version ${valid.baseCapability} is not stored`,
      );
    }
    const dir = join(this.root, pin.id, "overrides");
    await mkdir(dir, { recursive: true });
    const json = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(this.overridePath(pin.id, tenant), json, "utf8");
  }

  /**
   * Delete one tenant override after confirming the pin matches.
   *
   * `getOverride` first so a file pinned to a different version is left
   * untouched (`false`) rather than unenrolling the wrong pin.
   */
  async removeOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<boolean> {
    const pin = parseBaseCapabilityPin(baseCapability);
    const safeTenant = assertCatalogId(tenant);
    const existing = await this.getOverride(safeTenant, baseCapability);
    if (existing === undefined) {
      return false;
    }
    try {
      await rm(this.overridePath(pin.id, safeTenant));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /** `<root>/<id>/<version>.json` — tenant is never in this path. */
  private artifactPath(id: string, version: string): string {
    return join(this.root, id, `${version}.json`);
  }

  /** `<root>/<id>/overrides/<tenant>.json` — one enrolled tenant per file. */
  private overridePath(id: string, tenant: string): string {
    return join(this.root, id, "overrides", `${tenant}.json`);
  }

  /**
   * Read and schema-validate one override file.
   *
   * ENOENT is `undefined` (not enrolled). Other IO and validation errors
   * propagate — a corrupt override must not look like a missing tenant.
   */
  private async readOverrideFile(
    id: string,
    tenant: string,
  ): Promise<CapabilityOverride | undefined> {
    const safeId = assertCatalogId(id);
    const safeTenant = assertCatalogId(tenant);
    try {
      const raw = await readFile(this.overridePath(safeId, safeTenant), "utf8");
      return validateCapabilityOverride(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Directory names under `root` that look like catalog ids.
   *
   * Skip names that fail {@link assertCatalogId} so a junk folder cannot
   * become a capability id. Missing `root` is an empty catalog, not a throw.
   */
  private async readCapabilityIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => {
          try {
            assertCatalogId(name);
            return true;
          } catch {
            return false;
          }
        });
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Newest three-part semver among `<id>/*.json` filenames.
   *
   * `overrides/` is a directory, so it never appears in this list. Invalid
   * filenames are skipped so a stray `notes.json` cannot become a version.
   * Sort with {@link compareCapabilityVersion} so `1.10.0` wins over `1.9.0`.
   */
  private async latestVersion(id: string): Promise<string | undefined> {
    const dir = join(this.root, id);
    try {
      const entries = await readdir(dir);
      const versions = entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .filter((version) => {
          try {
            assertCatalogVersion(version);
            return true;
          } catch {
            return false;
          }
        })
        .sort(compareCapabilityVersion);
      return versions[versions.length - 1];
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

/**
 * True only for missing-path errors.
 *
 * Other codes (EACCES, EISDIR) must surface. Mapping every failure to
 * `undefined` would hide a broken catalog as "not enrolled".
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
