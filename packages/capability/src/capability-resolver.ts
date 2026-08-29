/**
 * @file CapabilityResolver — load an enrolled tenant override and return an effective artifact.
 *
 * Replay and MCP always go through this class. A missing override means not
 * enrolled — never fall back to the bare Vendor+Product base. A version-pin
 * mismatch is refused, not applied. `overrides: {}` is a no-op clone.
 * The effective artifact is never written to disk.
 */

import type { CapabilityArtifact } from "./artifact.js";
import { applyCapabilityOverride } from "./apply-override.js";
import { parseBaseCapabilityPin } from "./catalog-ids.js";
import type { CapabilityRegistry } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";

/**
 * Lookup for enrolled replay.
 *
 * `version` omitted means latest `capabilityVersion` for `id`. `tenant` is
 * required; resolve never invents a default.
 */
export interface ResolveCapabilityQuery {
  id: string;
  version?: string;
  tenant: string;
}

/**
 * Thrown when resolve cannot load an enrolled, version-compatible effective capability.
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
   * Fail closed: missing catalog row, missing enrollment, or a pin that does
   * not match the loaded `capabilityVersion` all throw. Do not silently use
   * the bare base. Header-only `overrides: {}` still enrolls; apply is a no-op.
   *
   * @param query - Capability id, optional version, and enrolled tenant
   * @returns Schema-valid effective artifact (in memory only)
   * @throws {CapabilityResolveError} When the capability, enrollment, or version pin is missing
   * @throws {CapabilityValidationError} When the merged artifact is invalid
   */
  async resolve(query: ResolveCapabilityQuery): Promise<CapabilityArtifact> {
    const base = await this.registry.get(query.id, query.version);
    if (base === undefined) {
      const versionLabel =
        query.version === undefined ? query.id : `${query.id}@${query.version}`;
      throw new CapabilityResolveError(
        `capability "${versionLabel}" is not in the catalog`,
      );
    }

    const pin = `${base.id}@${base.capabilityVersion}`;
    const enrolled = await this.registry.listOverrides({ tenant: query.tenant });
    // Match by capability id first so a stale pin (same id, older version) is
    // visible and can be refused, rather than treated as "not enrolled".
    const override = enrolled.find((candidate) => {
      const candidatePin = parseBaseCapabilityPin(candidate.baseCapability);
      return candidatePin.id === base.id;
    });
    if (override === undefined) {
      // Fail closed: missing file means not enrolled, never "use base as-is".
      throw new CapabilityResolveError(
        `tenant "${query.tenant}" is not enrolled for ${pin}`,
      );
    }
    if (override.baseCapability !== pin) {
      // Refuse a patch authored against a different capabilityVersion.
      // Never apply it silently — locators and checkpoints may not hold.
      throw new CapabilityResolveError(
        `incompatible override: pinned ${override.baseCapability}, loaded ${pin}`,
      );
    }

    // Header-only `overrides: {}` clones `base`; a real patch is declarative.
    const effective = applyCapabilityOverride(base, override);
    return validateCapabilityArtifact(effective);
  }
}
