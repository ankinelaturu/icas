/**
 * @file Map capability artifacts to MCP tool names and Zod input shapes.
 *
 * The capability schema stays transport-independent. Hyphens become
 * underscores so tool names match `loan_payoff` in the design note.
 */

import type { CapabilityArtifact, PrimitiveType } from "@icas/capability";
import { z, type ZodTypeAny } from "zod";

import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";

/**
 * Convert a catalog id to an MCP tool name.
 *
 * @param id - Capability id such as `loan-payoff`
 */
export function capabilityIdToToolName(id: string): string {
  return id.replaceAll("-", "_");
}

/**
 * Zod field for one capability primitive.
 *
 * `date` and `money` stay strings so JSON-RPC round-trips match replay.
 *
 * @param type - Artifact primitive
 */
export function zodForPrimitive(type: PrimitiveType): ZodTypeAny {
  switch (type) {
    case "string":
    case "date":
    case "money":
      return z.string().min(1);
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/**
 * Transport fields on every tool. Not capability inputs. Never inferred from
 * `url`. Omitted tenant / vendor / product default from this capability.
 */
export const MCP_TRANSPORT_FIELDS = [
  "url",
  "tenant",
  "vendor",
  "product",
  "assist",
] as const;

/**
 * Identity defaults copied from the catalog row at tool registration.
 *
 * Vendor/product are `target`. Tenant is `discoveredOn` (who was enrolled at
 * discover), not every override — `loan-payoff` still needs an explicit
 * `icas-banc` tenant. Missing `discoveredOn` falls back to `icas-bank`.
 *
 * @param artifact - Catalog row used to register the tool
 */
export function mcpIdentityDefaults(artifact: CapabilityArtifact): {
  tenant: string;
  vendor: string;
  product: string;
} {
  return {
    vendor: artifact.target.vendor,
    product: artifact.target.product,
    tenant: artifact.discoveredOn?.tenant ?? DEFAULT_ICAS_IDENTITY,
  };
}

/**
 * Optional identity field with a JSON Schema `default` for Inspector / hosts.
 *
 * @param description - Shown on the tool input
 * @param defaultValue - This capability's vendor, product, or discover tenant
 */
function identityField(description: string, defaultValue: string): ZodTypeAny {
  return z.string().min(1).describe(description).default(defaultValue);
}

/**
 * MCP input shape: surface `url`, optional identity, then capability inputs.
 *
 * `url` is where to open the browser, not identity. Zod `.default` on tenant /
 * vendor / product is this capability's identity so MCP Inspector / hosts can
 * show it. `assist` defaults false. An explicit value still wins. Vendor and
 * product must match the artifact target (same gate as `icas-play run`).
 *
 * @param artifact - Catalog row
 */
export function mcpInputShape(artifact: CapabilityArtifact): Record<string, ZodTypeAny> {
  const identity = mcpIdentityDefaults(artifact);
  const shape: Record<string, ZodTypeAny> = {
    url: z.string().min(1).describe("Surface entry URL (not tenant identity)"),
    tenant: identityField("Enrolled tenant id", identity.tenant),
    vendor: identityField(
      "Vendor identity; must match the capability target",
      identity.vendor,
    ),
    product: identityField(
      "Product identity; must match the capability target",
      identity.product,
    ),
    assist: z
      .boolean()
      .default(false)
      .describe(
        "One bounded LLM repair on a locator miss. Uses ICAS_ASSIST_LLM_*. Does not persist an override.",
      ),
  };
  for (const [name, spec] of Object.entries(artifact.inputs)) {
    let field = zodForPrimitive(spec.type);
    if (spec.description !== undefined) {
      field = field.describe(spec.description);
    }
    shape[name] = spec.required === true ? field : field.optional();
  }
  return shape;
}
