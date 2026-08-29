/**
 * @file FileSystemCapabilityRegistry — filesystem catalog of base capability JSON files.
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
 */
export class FileSystemCapabilityRegistry implements CapabilityRegistry {
  private readonly root: string;

  /**
   * @param options.root - Catalog directory. Tests pass a temp path, never repo `capabilities/`.
   */
  constructor(options: FileSystemCapabilityRegistryOptions) {
    this.root = options.root;
  }

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

  async save(capability: CapabilityArtifact): Promise<void> {
    const valid = validateCapabilityArtifact(capability);
    const id = assertCatalogId(valid.id);
    const version = assertCatalogVersion(valid.capabilityVersion);
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true });
    const json = `${JSON.stringify(valid, null, 2)}\n`;
    await writeFile(this.artifactPath(id, version), json, "utf8");
  }

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

  private artifactPath(id: string, version: string): string {
    return join(this.root, id, `${version}.json`);
  }

  private overridePath(id: string, tenant: string): string {
    return join(this.root, id, "overrides", `${tenant}.json`);
  }

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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
