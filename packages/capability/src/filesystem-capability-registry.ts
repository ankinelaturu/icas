/**
 * @file FileSystemCapabilityRegistry — filesystem catalog of base capability JSON files.
 *
 * Layout under the injectable `root` (production: repo `capabilities/`; tests:
 * a temp directory, never the submission catalog):
 *
 * ```
 * <root>/<id>/capability.json          # Vendor+Product base (one per id)
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
import { assertCatalogId } from "./catalog-ids.js";
import type { CapabilityOverride } from "./capability-override.js";
import type { CapabilityRegistry, CapabilitySummary } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";
import { validateCapabilityOverride } from "./validate-override.js";

/** Fixed base filename so operators do not confuse flow version with schemaVersion. */
const BASE_FILENAME = "capability.json";

export interface FileSystemCapabilityRegistryOptions {
  /** Catalog root. Production is repo `capabilities/`; tests pass a temp directory. */
  root: string;
}

/**
 * Filesystem-backed {@link CapabilityRegistry}.
 * Layout: `<root>/<id>/capability.json` and `<root>/<id>/overrides/<tenant>.json`.
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
   * List one stored base per id, optionally filtered by Vendor+Product.
   *
   * Empty id directories (no `capability.json`) are skipped. Sort by id so
   * catalog UIs stay stable across readdir order.
   */
  async list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]> {
    const ids = await this.readCapabilityIds();
    const summaries: CapabilitySummary[] = [];
    for (const id of ids) {
      const artifact = await this.get(id);
      if (artifact === undefined) {
        continue;
      }
      if (filter?.vendor !== undefined && artifact.target.vendor !== filter.vendor) {
        continue;
      }
      if (
        filter?.product !== undefined &&
        artifact.target.product !== filter.product
      ) {
        continue;
      }
      summaries.push({
        id: artifact.id,
        name: artifact.name,
        schemaVersion: artifact.schemaVersion,
        target: artifact.target,
      });
    }
    summaries.sort((a, b) => a.id.localeCompare(b.id));
    return summaries;
  }

  /**
   * Load the base artifact for `id`.
   *
   * Assert the id before joining paths. Missing file is `undefined`, not a
   * throw, so list can skip empty dirs. Corrupt JSON still throws — do not
   * treat parse failure as "not in catalog".
   */
  async get(id: string): Promise<CapabilityArtifact | undefined> {
    const safeId = assertCatalogId(id);
    const path = this.artifactPath(safeId);
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
   * Schema-validate then upsert `<root>/<id>/capability.json`.
   *
   * Validate first so invalid artifacts never land on disk. Pretty-print with
   * a trailing newline so git diffs stay reviewable.
   */
  async save(capability: CapabilityArtifact): Promise<void> {
    const valid = validateCapabilityArtifact(capability);
    const id = assertCatalogId(valid.id);
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true });
    const json = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(this.artifactPath(id), json, "utf8");
  }

  /**
   * Remove the whole id directory, including `overrides/`.
   *
   * That unenrolls every tenant for this id. `force: false` so a missing dir
   * is `false`, not a silent ok.
   */
  async remove(id: string): Promise<boolean> {
    const safeId = assertCatalogId(id);
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
   * Load one tenant override named by base catalog id.
   *
   * Fail closed on id mismatch: a file for `loan-payoff` must not be returned
   * when the caller asked for a different id. Missing file is `undefined`
   * (not enrolled).
   */
  async getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined> {
    const id = assertCatalogId(baseCapability);
    const override = await this.readOverrideFile(id, tenant);
    if (override === undefined) {
      return undefined;
    }
    if (override.baseCapability !== id) {
      return undefined;
    }
    return override;
  }

  /**
   * Schema-validate then upsert `<root>/<id>/overrides/<tenant>.json`.
   *
   * Refuse when the named base is not stored. Header-only `overrides: {}` is a
   * valid write; that is how first discover enrolls the discovering tenant.
   */
  async saveOverride(override: CapabilityOverride): Promise<void> {
    const valid = validateCapabilityOverride(override);
    const id = assertCatalogId(valid.baseCapability);
    const tenant = assertCatalogId(valid.target.tenant);
    const base = await this.get(id);
    if (base === undefined) {
      throw new Error(`base capability "${valid.baseCapability}" is not stored`);
    }
    const dir = join(this.root, id, "overrides");
    await mkdir(dir, { recursive: true });
    const json = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(this.overridePath(id, tenant), json, "utf8");
  }

  /**
   * Delete one tenant override after confirming the base id matches.
   *
   * `getOverride` first so a mismatched file is left untouched (`false`).
   */
  async removeOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<boolean> {
    const id = assertCatalogId(baseCapability);
    const safeTenant = assertCatalogId(tenant);
    const existing = await this.getOverride(safeTenant, baseCapability);
    if (existing === undefined) {
      return false;
    }
    try {
      await rm(this.overridePath(id, safeTenant));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /** `<root>/<id>/capability.json` — tenant is never in this path. */
  private artifactPath(id: string): string {
    return join(this.root, id, BASE_FILENAME);
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
