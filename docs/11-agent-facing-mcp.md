# 11 — Agent-Facing MCP Interface

## Purpose

`icas-mcp` implements the optional agent-facing capability interface. It exposes saved capability artifacts as tools that another agent/host can discover and invoke by name with typed arguments.

## Architecture

```text
Saved capabilities
      ↓
CapabilityRegistry
      ↓
MCP adapter / server
      ↓
Agent host discovers tools
      ↓
loan_payoff(...typed args...)
      ↓
ReplayEngine
      ↓
Surface
```

## Separation from `icas-play`

Both are adapters over the same registry/replay core:

```text
CapabilityRegistry
   ├── icas-play  → human-facing CLI
   └── icas-mcp   → agent-facing protocol
```

`icas-play` may list/describe/run capabilities for humans. That is not by itself the agent-facing stretch goal. `icas-mcp` makes the catalog machine-discoverable as tools. Both must go through `CapabilityRegistry` / `CapabilityResolver` rather than reading files directly. Invocation uses capability id + tenant (MCP host should pass tenant or accept the `icas` default) + runtime URL + typed args. The tenant must already be enrolled. Catalog API and on-disk layout are specified in [`04-capability-artifact.md`](04-capability-artifact.md).

## MCP server shape

`icas-mcp` is both:

- an executable CLI/server entry point;
- an importable package boundary around server construction.

For the local demo, stdio transport is simplest: the agent host launches `icas-mcp` as a child process and communicates through MCP over stdin/stdout.

A future remote deployment could use HTTP transport without changing capability/replay semantics.

## Dynamic tool generation

A capability such as:

```text
id: loan-payoff
inputs:
  loanAccountId: string
  payoffDate: date
```

becomes an MCP tool conceptually equivalent to:

```ts
loan_payoff({
  loanAccountId: "987654",
  payoffDate: "2026-09-30"
})
```

Invocation delegates to:

```ts
ReplayEngine.run(capability, args)
```

The MCP adapter should not duplicate browser or replay logic.

## Important boundary

MCP must not infect the capability schema. The capability remains transport-independent and can be exposed through:

- CLI;
- MCP;
- future REST/function-call adapters.
