/**
 * @file Map capability artifacts to MCP tool names and Zod input shapes.
 *
 * The capability schema stays transport-independent. Hyphens become
 * underscores so tool names match `loan_payoff` in the design note.
 */

import type { CapabilityArtifact, PrimitiveType } from "@icas/capability";
import { z, type ZodTypeAny } from "zod";

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
 * `url`. Omitted tenant / vendor / product default to `icas-bank` at invoke.
 */
export const MCP_TRANSPORT_FIELDS = ["url", "tenant", "vendor", "product"] as const;

/**
 * MCP input shape: surface `url`, optional identity, then capability inputs.
 *
 * `url` is where to open the browser, not identity. `tenant` / `vendor` /
 * `product` default at invoke time to `icas-bank` when omitted. Vendor and
 * product must match the artifact target (same gate as `icas-play run`).
 *
 * @param artifact - Catalog row
 */
export function mcpInputShape(artifact: CapabilityArtifact): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {
    url: z.string().min(1).describe("Surface entry URL (not tenant identity)"),
    tenant: z.string().min(1).optional().describe("Enrolled tenant id"),
    vendor: z
      .string()
      .min(1)
      .optional()
      .describe("Vendor identity; must match the capability target"),
    product: z
      .string()
      .min(1)
      .optional()
      .describe("Product identity; must match the capability target"),
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
