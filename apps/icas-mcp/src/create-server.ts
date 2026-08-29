/**
 * @file Construct an MCP server from CapabilityRegistry.list/get.
 *
 * One tool per latest capability. This pass registers typed input schemas;
 * invoke still returns a stub until ReplayEngine is wired.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CapabilityRegistry } from "@icas/capability";

import { capabilityIdToToolName, mcpInputShape } from "./tool-schema.js";

/**
 * One MCP tool descriptor derived from a catalog artifact.
 */
export interface CatalogToolDefinition {
  name: string;
  capabilityId: string;
  title: string;
  description: string;
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
 * Build an MCP server whose tools mirror the catalog.
 *
 * Does not glob `capabilities/`. Does not start a transport.
 *
 * @param registry - Catalog backend
 */
export async function createIcasMcpServer(registry: CapabilityRegistry): Promise<McpServer> {
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
    server.registerTool(
      name,
      {
        title: artifact.name,
        description:
          artifact.description ??
          `${artifact.name} (${artifact.target.vendor}/${artifact.target.product})`,
        inputSchema: mcpInputShape(artifact),
      },
      async () => {
        // Pass 6.12 replaces this stub with CapabilityResolver + ReplayEngine.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `tool "${name}" is registered; invoke is not wired in this pass`,
            },
          ],
        };
      },
    );
  }
  return server;
}
