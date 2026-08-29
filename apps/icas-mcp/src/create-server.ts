/**
 * @file Construct an MCP server from CapabilityRegistry.list/get.
 *
 * One tool per latest capability. Invoke uses {@link invokeMcpCapability}
 * (CapabilityResolver + ReplayEngine), not a second browser stack.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CapabilityRegistry } from "@icas/capability";
import type { ExecutionResult } from "@icas/replay";

import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import {
  invokeMcpCapability,
  type McpInvokeDeps,
} from "./invoke-replay.js";
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
        // Zod already validated the shape. url/tenant are MCP transport fields,
        // not capability inputs, and tenant is never inferred from url.
        const parsed = rawArgs as Record<string, unknown>;
        const url = String(parsed.url ?? "");
        const tenant =
          parsed.tenant === undefined || parsed.tenant === ""
            ? DEFAULT_ICAS_IDENTITY
            : String(parsed.tenant);
        const inputs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "url" || key === "tenant") {
            continue;
          }
          inputs[key] = value;
        }
        try {
          const result = await invokeMcpCapability(
            { capabilityId, url, tenant, inputs },
            {
              registry,
              ...(deps.executeReplay === undefined
                ? {}
                : { executeReplay: deps.executeReplay }),
            },
          );
          return formatToolResult(result);
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

function formatToolResult(result: ExecutionResult): {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
} {
  const text = JSON.stringify(result);
  if (result.status === "success") {
    return { content: [{ type: "text", text }] };
  }
  return { isError: true, content: [{ type: "text", text }] };
}
