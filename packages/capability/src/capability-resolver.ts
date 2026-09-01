/**
 * @file CapabilityResolver — load an enrolled tenant override and return an effective artifact.
 *
 * Replay and MCP always go through this class. A missing override means not
 * enrolled — never fall back to the bare Vendor+Product base.
 * `overrides: {}` is a no-op clone. The effective artifact is never written
 * to disk. There is one base per id; the tenant override selects the patch.
 */

import type { CapabilityArtifact } from "./artifact.js";
import { applyCapabilityOverride } from "./apply-override.js";
import type { CapabilityRegistry } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";

/**
 * Lookup for enrolled replay.
 *
 * `tenant` is required; resolve never invents a default.
 */
export interface ResolveCapabilityQuery {
  id: string;
  tenant: string;
}

/**
 * Thrown when resolve cannot load an enrolled effective capability.
 *
 * Distinct from {@link CapabilityValidationError}: this is catalog/enrollment
 * failure, not a schema problem on the merged artifact.
 */
export class CapabilityResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityResolveError";
  }
}

/**
 * Resolve a base capability plus an enrolled tenant override into an effective
 * artifact. The result is never written to disk.
 *
 * `ReplayEngine` is tenant-agnostic; it only receives this effective artifact.
 * Discovery and adapt may load the base without going through resolve while
 * they create the enrollment file.
 */
export class CapabilityResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Load base + tenant override, apply the declarative patch, and schema-validate.
   *
   * Fail closed: missing catalog row or missing enrollment throw. Do not
   * silently use the bare base. Header-only `overrides: {}` still enrolls;
   * apply is a no-op.
   *
   * @param query - Capability id and enrolled tenant
   * @returns Schema-valid effective artifact (in memory only)
   * @throws {CapabilityResolveError} When the capability or enrollment is missing
   * @throws {CapabilityValidationError} When the merged artifact is invalid
   */
  async resolve(query: ResolveCapabilityQuery): Promise<CapabilityArtifact> {
    const base = await this.registry.get(query.id);
    if (base === undefined) {
      throw new CapabilityResolveError(
        `capability "${query.id}" is not in the catalog`,
      );
    }

    const enrolled = await this.registry.listOverrides({ tenant: query.tenant });
    const override = enrolled.find(
      (candidate) => candidate.baseCapability === base.id,
    );
    if (override === undefined) {
      // Fail closed: missing file means not enrolled, never "use base as-is".
      throw new CapabilityResolveError(
        `tenant "${query.tenant}" is not enrolled for ${base.id}`,
      );
    }

    // Header-only `overrides: {}` clones `base`; a real patch is declarative.
    const effective = applyCapabilityOverride(base, override);
    return validateCapabilityArtifact(effective);
  }
}
