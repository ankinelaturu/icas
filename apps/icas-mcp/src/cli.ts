#!/usr/bin/env node
/**
 * @file icas-mcp — agent-facing stdio MCP server.
 *
 * Stdout is the protocol byte stream. Do not log on stdout.
 * Tools come from {@link CapabilityRegistry}, not a filesystem glob.
 *
 * SDK is pinned (`@modelcontextprotocol/sdk@1.30.0`); do not depend on `latest`.
 *
 * @see docs/11-agent-facing-mcp.md
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileSystemCapabilityRegistry } from "@icas/capability";

import { catalogRoot } from "./catalog-root.js";
import { createIcasMcpServer } from "./create-server.js";
import { loadRepoEnv } from "./load-repo-env.js";

/**
 * Start stdio MCP. Catalog root follows `ICAS_CAPABILITIES_ROOT`.
 *
 * Load repo `.env` so `assist: true` can read `ICAS_ASSIST_LLM_*` when the
 * host only passed catalog/evidence paths. Do not write to stdout.
 */
export async function startMcpStdio(): Promise<void> {
  loadRepoEnv();
  const registry = new FileSystemCapabilityRegistry({ root: catalogRoot() });
  const server = await createIcasMcpServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (isMain) {
  void startMcpStdio().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
