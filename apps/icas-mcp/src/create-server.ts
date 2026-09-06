/**
 * @file Construct an MCP server from CapabilityRegistry.list/get.
 *
 * One tool per catalog id. Invoke uses {@link invokeMcpCapability}
 * (CapabilityResolver + ReplayEngine), not a second browser stack.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CapabilityRegistry } from "@icas/capability";

import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import { formatMcpToolResult } from "./format-tool-result.js";
import {
  invokeMcpCapability,
  type McpInvokeDeps,
} from "./invoke-replay.js";
import { capabilityIdToToolName, mcpInputShape, MCP_TRANSPORT_FIELDS } from "./tool-schema.js";

/**
 * One MCP tool descriptor derived from a catalog artifact.
 */
export interface CatalogToolDefinition {
  name: string;
  capabilityId: string;
  title: string;
  description: string;
}

export interface CreateIcasMcpServerDeps {
  executeReplay?: McpInvokeDeps["executeReplay"];
}

/**
 * List tool names the MCP server will register. Tests use this instead of
 * poking McpServer private maps.
 *
 * @param registry - Catalog backend
 */
export async function catalogToolDefinitions(
  registry: CapabilityRegistry,
): Promise<CatalogToolDefinition[]> {
  const rows = await registry.list();
  const tools: CatalogToolDefinition[] = [];
  for (const row of rows) {
    const artifact = await registry.get(row.id);
    if (artifact === undefined) {
      continue;
    }
    tools.push({
      name: capabilityIdToToolName(artifact.id),
      capabilityId: artifact.id,
      title: artifact.name,
      description:
        artifact.description ??
        `${artifact.name} (${artifact.target.vendor}/${artifact.target.product})`,
    });
  }
  return tools;
}

/**
 * Build an MCP server whose tools mirror the catalog and invoke ReplayEngine.
 *
 * @param registry - Catalog backend
 * @param deps - Optional test double for the browser session
 */
export async function createIcasMcpServer(
  registry: CapabilityRegistry,
  deps: CreateIcasMcpServerDeps = {},
): Promise<McpServer> {
  const server = new McpServer({
    name: "icas-mcp",
    version: "0.1.0",
  });
  const rows = await registry.list();
  for (const row of rows) {
    const artifact = await registry.get(row.id);
    if (artifact === undefined) {
      continue;
    }
    const name = capabilityIdToToolName(artifact.id);
    const capabilityId = artifact.id;
    server.registerTool(
      name,
      {
        title: artifact.name,
        description:
          artifact.description ??
          `${artifact.name} (${artifact.target.vendor}/${artifact.target.product})`,
        inputSchema: mcpInputShape(artifact),
      },
      async (rawArgs) => {
        // Zod already validated the shape. url/tenant/vendor/product are MCP
        // transport fields, not capability inputs, and never inferred from url.
        const parsed = rawArgs as Record<string, unknown>;
        const url = String(parsed.url ?? "");
        const tenant = identityArg(parsed.tenant);
        const vendor = identityArg(parsed.vendor);
        const product = identityArg(parsed.product);
        const inputs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if ((MCP_TRANSPORT_FIELDS as readonly string[]).includes(key)) {
            continue;
          }
          inputs[key] = value;
        }
        try {
          const result = await invokeMcpCapability(
            { capabilityId, url, tenant, vendor, product, inputs },
            {
              registry,
              ...(deps.executeReplay === undefined
                ? {}
                : { executeReplay: deps.executeReplay }),
            },
          );
          return formatMcpToolResult(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      },
    );
  }
  return server;
}

/**
 * Optional identity tool arg. Empty or omitted means {@link DEFAULT_ICAS_IDENTITY}.
 *
 * @param value - Raw Zod field
 */
function identityArg(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : DEFAULT_ICAS_IDENTITY;
}

