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
} from "./catalog-ids.js";
import type { CapabilityRegistry, CapabilitySummary } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";

export interface FileSystemCapabilityRegistryOptions {
  /** Catalog root. Production is repo `capabilities/`; tests pass a temp directory. */
  root: string;
}

/**
 * Filesystem-backed {@link CapabilityRegistry}. Layout: `<root>/<id>/<version>.json`.
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

  private artifactPath(id: string, version: string): string {
    return join(this.root, id, `${version}.json`);
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
