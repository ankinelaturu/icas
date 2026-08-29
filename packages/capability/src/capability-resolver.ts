/**
 * @file CapabilityResolver — load an enrolled tenant override and return an effective artifact.
 */

import type { CapabilityArtifact } from "./artifact.js";
import { applyCapabilityOverride } from "./apply-override.js";
import { parseBaseCapabilityPin } from "./catalog-ids.js";
import type { CapabilityRegistry } from "./registry.js";
import { validateCapabilityArtifact } from "./validate-capability.js";

export interface ResolveCapabilityQuery {
  id: string;
  version?: string;
  tenant: string;
}

/**
 * Thrown when resolve cannot load an enrolled, version-compatible effective capability.
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
 */
export class CapabilityResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Load base + tenant override, apply the declarative patch, and schema-validate.
   *
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
    const override = enrolled.find((candidate) => {
      const candidatePin = parseBaseCapabilityPin(candidate.baseCapability);
      return candidatePin.id === base.id;
    });
    if (override === undefined) {
      throw new CapabilityResolveError(
        `tenant "${query.tenant}" is not enrolled for ${pin}`,
      );
    }
    if (override.baseCapability !== pin) {
      throw new CapabilityResolveError(
        `incompatible override: pinned ${override.baseCapability}, loaded ${pin}`,
      );
    }

    const effective = applyCapabilityOverride(base, override);
    return validateCapabilityArtifact(effective);
  }
}
