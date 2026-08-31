# ICAS — Interface Computer-Use Automation System

ICAS is a small end-to-end computer-use automation system built for the Interface.AI engineering take-home. It separates **discovery** from **execution**:

- `icas-agent` uses an LLM to discover how to complete a goal against a real UI.
- A successful discovery is compiled into a typed, versioned capability artifact.
- `icas-play` replays a known capability deterministically, with pre/post-condition checks, structured outputs, runtime error semantics, and optional bounded assisted fallback.
- `icas-adapt` specializes a known capability for another tenant running the same vendor/product when checkpoints reveal drift.
- `icas-mcp` exposes saved capabilities as tools that another AI agent can discover and invoke by name with typed arguments.

The repository intentionally keeps the runnable entry points separate from reusable runtime packages and from the synthetic tenant applications used as automation targets.

## Repository layout

```text
apps/          Runnable ICAS programs
packages/      Reusable ICAS implementation
 tenants/      Synthetic banking tenants / target applications
capabilities/  Generated capability artifacts
 evidence/     Run traces, replay logs, screenshots, and handoff evidence
docs/          Detailed architecture and design decisions
tests/         Cross-package integration and end-to-end tests
```

## Demo path

Start the synthetic bank, then discover against it.

```bash
pnpm install
pnpm icas-bank

# Discover a new capability (--vendor/--product/--tenant default to icas-bank)
pnpm icas-agent -- \
  discover \
  --id loan-payoff \
  --url http://localhost:4101 \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"

# Discover takes --id, --url, --goal only (plus optional identity/version).
# The model names invocation params; icas-play still passes them by name.

# Browse known capabilities
pnpm icas-play -- list
pnpm icas-play -- describe loan-payoff

# Deterministic replay (same defaults; URL + typed params required)
pnpm icas-play -- \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountId 987654 \
  --payoffDate 2026-09-30

# Optional one-step assisted fallback
pnpm icas-play -- \
  run loan-payoff \
  --assist \
  --url http://localhost:4101 \
  --loanAccountId 987654 \
  --payoffDate 2026-09-30

# Adapt to Loki Bank (same vendor/product, label drift)
pnpm loki-bank
pnpm icas-adapt -- \
  loan-payoff \
  --tenant loki-bank \
  --url http://localhost:4102

# Expose capabilities over MCP
pnpm icas-mcp
```

## Design principles

1. **The model discovers; replay executes.** LLM reasoning is used where the route is unknown. Known capabilities replay without model decisions by default.
2. **A capability is a contract, not a transcript.** The artifact contains typed inputs/outputs, ordered actions, target descriptions, preconditions, postconditions, success conditions, and version metadata.
3. **Replay is guarded, not blind.** Every step can validate the state before and after its action.
4. **Same product does not imply identical tenant UI.** A capability for a vendor/product is a candidate for reuse. Tenant compatibility must be verified by checkpoints or adapted deliberately.
5. **Safety is layered.** Prompt policy influences model proposals; runtime policy gates actual execution; redaction controls what may leave runtime memory or be persisted.
6. **Human handoff means control transfer.** Automation can pause, cede the same live browser session to a human, capture what changed, and resume.
7. **Surface-specific code stays behind an abstraction.** Playwright is the implemented web surface, but capability semantics should not fundamentally depend on the DOM.

See [`docs/README.md`](docs/README.md) for the detailed design notes.

## Status

This repository is a scaffold. Tenant implementations, final locator strategy, model prompts, and runtime code will be filled in incrementally while preserving the architecture documented under `docs/`.
