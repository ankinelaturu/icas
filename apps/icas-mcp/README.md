# icas-mcp

Agent-facing MCP server exposing saved capabilities as typed tools backed by ReplayEngine.

The MCP TypeScript SDK is pinned to `@modelcontextprotocol/sdk@1.30.0` (not `latest`).

```text
pnpm icas-mcp
```

Starts a stdio MCP server. Each catalog capability becomes one tool (`loan-payoff` → `loan_payoff`) with typed arguments from the artifact inputs plus `url` and optional `tenant`.
