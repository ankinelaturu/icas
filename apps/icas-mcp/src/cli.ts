#!/usr/bin/env node
/**
 * @file icas-mcp — agent-facing MCP adapter (scaffold).
 *
 * Exposes each saved capability as a typed tool. Invocation uses the same
 * `CapabilityResolver` + `ReplayEngine` path as `icas-play`. This app must
 * not glob `capabilities/`, implement replay, or silently use an unenrolled
 * tenant's bare base. Stdio first: stdout is the protocol byte stream.
 *
 * SDK is pinned (`@modelcontextprotocol/sdk@1.30.0`); do not depend on `latest`.
 *
 * Stay thin: construct the MCP server and delegate tool calls. A human CLI
 * (`icas-play`) is not the stretch goal this file exists to satisfy.
 *
 * @see docs/01-system-overview.md
 * @see docs/11-agent-facing-mcp.md
 */

// Log on stderr so a later stdio MCP server can keep stdout as the byte stream.
console.error("icas-mcp scaffold");
console.error("Planned: start an MCP server (stdio first) and expose each saved capability as a typed tool backed by ReplayEngine.");
