# ICAS — Interface Computer-Use Automation System

ICAS is a small end-to-end computer-use automation system built for the Interface.AI engineering take-home. It separates **discovery** from **execution**:

- `icas-agent` uses an LLM to discover how to complete a goal against a live UI.
- A successful discovery is compiled into a typed capability artifact (catalog `id` only; tenant differences live on overrides).
- `icas-play` replays a known capability deterministically, with checkpoints, structured outputs, exceptional-state classification from compiled `possibleOutcomes`, and optional bounded `--assist`.
- `icas-adapt` specializes a known capability for another tenant running the same vendor/product when checkpoints reveal drift.
- `icas-mcp` exposes saved capabilities as tools that another AI agent can discover and invoke by name with typed arguments.

The repository keeps runnable entry points in `apps/`, behavior in `packages/`, and synthetic tenant apps in `tenants/`.

## Repository layout

```text
apps/          Runnable ICAS programs
packages/      Reusable ICAS implementation
tenants/       Synthetic banking tenants (icas-bank, loki-bank, helix-cu)
capabilities/  Generated capability artifacts (do not hand-author)
evidence/      Run traces, replay logs, screenshots, and handoff evidence
docs/          Architecture and design decisions
tests/         Cross-package integration tests
```

## Setup

```bash
pnpm install
cp .env.example .env
# Set ICAS_DISCOVERY_LLM_API_KEY (and ICAS_ASSIST_LLM_API_KEY if you use --assist).
# MODEL is provider/model, default openai/gpt-4o. Leave BASE_URL empty for hosted APIs.
pnpm build
```

Callers must not glob `capabilities/`. CLIs use `FileSystemCapabilityRegistry` (override with `ICAS_CAPABILITIES_ROOT`). Evidence defaults to `./evidence` (`ICAS_EVIDENCE_ROOT`).

## Demo path

Start the synthetic bank, then discover against it. `--vendor` / `--product` / `--tenant` default to `icas-bank` and are never inferred from `--url`.

```bash
pnpm icas-bank

# Required: --id (unique), --url, --goal. Put values to type in the goal.
# Discover refuses an existing --id. The model names params; do not pass --loanAccountId here.
pnpm icas-agent \
  discover \
  --id loan-payoff \
  --url http://localhost:4101 \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"

pnpm icas-play list
pnpm icas-play describe loan-payoff

# Deterministic replay (no LLM). Tenant must be enrolled. Different loan than discovery:
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountId 112233 \
  --payoffDate 2026-09-30

# Unknown loan → business_outcome from compiled possibleOutcomes (not an engine enum)
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountId 000000 \
  --payoffDate 2026-09-30

# Optional one-step assisted fallback (ICAS_ASSIST_LLM_*)
pnpm icas-play \
  run loan-payoff \
  --assist \
  --url http://localhost:4101 \
  --loanAccountId 112233 \
  --payoffDate 2026-09-30

# Loki Bank: same vendor/product, label drift. Keep icas-bank running on 4101.
pnpm loki-bank
pnpm icas-adapt \
  loan-payoff \
  --tenant loki-bank \
  --url http://localhost:4102 \
  --loanAccountId 112233 \
  --payoffDate 2026-09-30

# Stdio MCP server. Hosts see tool loan_payoff (hyphens → underscores).
pnpm icas-mcp
```

Known-good icas-bank loans: `987654` (primary), `112233` (second active). Missing ids show `No loan record found`. See `tenants/icas-bank/README.md`.

HITL is control transfer of the **same** headed browser session (not a co-browsing console). Policy-risky actions and compiled `kind: "hitl"` outcomes pause that session.

## Design principles

1. **The model discovers; replay executes.** LLM reasoning is used where the route is unknown. Known capabilities replay without model decisions by default.
2. **A capability is a contract, not a transcript.** The artifact contains typed inputs/outputs, ordered actions, target descriptions, checkpoints, optional `possibleOutcomes`, and overall success rules.
3. **Replay is guarded, not blind.** Every step can validate the state before and after its action. When the next locator is missing, replay classifies from that step's `possibleOutcomes`, then HTTP status and generic chrome.
4. **Same product does not imply identical tenant UI.** A capability for a vendor/product is a candidate for reuse. Tenant compatibility is an enrolled override resolved by `CapabilityResolver`. `ReplayEngine` never branches on tenant.
5. **Safety is layered.** Prompt policy influences model proposals; runtime policy gates actual execution; redaction controls what may leave runtime memory or be persisted.
6. **Human handoff means control transfer.** Automation can pause, cede the same live browser session to a human, capture what changed, and resume.
7. **Surface-specific code stays behind an abstraction.** Playwright is the implemented web surface, but capability semantics should not fundamentally depend on the DOM.

See [`docs/README.md`](docs/README.md) for the detailed design notes. Reviewer headings: [`REPORT.md`](REPORT.md).

## Status

The must-have vertical slice is implemented: discover → artifact + tenant enrollment → deterministic replay, exceptional-state classification, HITL, and evidence. Stretch already in-repo: `--assist`, `icas-adapt`, MCP. Pass 4.15 (phrase embeddings) and Pass 5.22 (screenshot pixels on `generate`) are deferred on purpose.
