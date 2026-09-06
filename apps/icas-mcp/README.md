# icas-mcp

Agent-facing MCP server exposing saved capabilities as typed tools backed by ReplayEngine.

The MCP TypeScript SDK is pinned to `@modelcontextprotocol/sdk@1.30.0` (not `latest`).

```text
pnpm icas-mcp
```

Starts a stdio MCP server. Each catalog capability becomes one tool (`loan-payoff` → `loan_payoff`) with typed arguments from the artifact inputs plus `url`, optional `tenant` / `vendor` / `product`, and optional `assist` (default false). Identity defaults from that capability (`discoveredOn.tenant`, `target.vendor` / `target.product`). Vendor and product must match the capability target. `assist: true` uses `ICAS_ASSIST_LLM_*` (repo `.env` loaded on start) and does not persist an override. Tool calls use `CapabilityResolver` + `ReplayEngine` (tenant must be enrolled). On `business_outcome`, the tool text includes `heading`, `summary`, and `message` (the phrase that hit); evidence still holds the screenshot.
