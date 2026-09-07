# 02 — Repository Structure

## Top-level layout

```text
icas/
├── apps/
│   ├── icas-agent/
│   ├── icas-play/
│   ├── icas-adapt/
│   └── icas-mcp/
├── tenants/
│   ├── icas-bank/
│   ├── icas-banc/
│   ├── loki-bank/
│   └── helix-cu/
├── packages/
│   ├── capability/
│   ├── discovery/
│   ├── replay/
│   ├── browser/
│   ├── surface/
│   ├── policy/
│   ├── redactor/
│   ├── handoff/
│   └── evidence/
├── capabilities/
├── evidence/
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docs/
├── README.md
└── REPORT.md
```

## Naming semantics

### `apps/`

Runnable/deployable ICAS entry points. In a monorepo, `apps` does not imply web applications; CLIs and servers are valid apps.

### `packages/`

Reusable runtime/library code. An app should remain thin and delegate behavior to packages.

### `tenants/`

Synthetic target banking applications. The term intentionally matches the Interface.AI brief: a tenant is one customer institution. `tenants/icas-bank` is the first institution (catalog vendor/product/tenant `icas-bank`). `tenants/icas-banc` is the same Vendor+Product with institution chrome and a **single** search-submit rename (Inquire → Look Up). `tenants/loki-bank` is a **separate install** of that same fictional Vendor+Product with broader label drift. `tenants/helix-cu` is a **different** vendor/product (share holds, div layout) so a second `--goal` can be discovered without reusing the loan-payoff path. See `tenants/README.md`.

### `capabilities/`

Generated, reusable capability artifacts. This is product output: what ICAS learned.

`@icas/capability` is the only package that reads or writes this tree. `CapabilityRegistry` is the catalog interface; `FileSystemCapabilityRegistry({ root })` is the implemented backend; `CapabilityResolver` derives an effective capability from a stored base plus optional tenant override. REST/DB backends are not part of this prototype. Layout and API are specified in [`04-capability-artifact.md`](04-capability-artifact.md).

### `evidence/`

Run-scoped proof and observability: discovery traces, replay logs, screenshots on failure, summaries, and human-handoff evidence. This is proof of what ICAS did.

### `docs/`

Detailed design source of truth used during development and implementation. Root `REPORT.md` stays short (seven headings).

### `tests/`

Cross-package integration and end-to-end tests (`tests/integration/`, `tests/e2e/`, `tests/fixtures/`). Package-local unit tests live in `packages/<name>/tests/` (and `tenants/<name>/tests/`), not beside `src/` files.

## Dependency direction

Dependencies should flow inward toward reusable contracts and never from core packages back into CLIs:

```text
apps/icas-agent
  → discovery
  → capability + surface
  → policy / redactor / handoff / evidence

apps/icas-play
  → replay
  → capability + surface
  → policy / redactor / handoff / evidence

apps/icas-adapt
  → replay + capability; Mastra StepSpecializer on mismatch (`ICAS_ADAPT_LLM_*`)

apps/icas-mcp
  → capability registry + replay

browser
  → surface + capability
```

## Workspace tooling

- pnpm workspaces for dependency management.
- Turborepo for build/test/typecheck orchestration.
- TypeScript strict mode.
- Vitest for unit/integration tests.
- Playwright for the implemented web surface.
- Mastra for agent orchestration during discovery.
- MCP TypeScript SDK for `icas-mcp`.

## Generated files

`capabilities/` and `evidence/` are intentionally runtime-generated. They remain visible at repository root because both are central artifacts and easy to inspect.
