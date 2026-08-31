# ICAS Design Notes

This directory is the detailed engineering source of truth for ICAS. The root `REPORT.md` is intentionally short and follows Interface.AI's required seven headings; these documents preserve the deeper reasoning used during implementation.

## Index

1. [`01-system-overview.md`](01-system-overview.md) — system goals, components, data flow, design principles.
2. [`02-repository-structure.md`](02-repository-structure.md) — monorepo layout and dependency boundaries.
3. [`03-discovery-agent.md`](03-discovery-agent.md) — `icas-agent`, Mastra, visual observation, bounded search, `possibleOutcomes`, trace, compiler.
4. [`04-capability-artifact.md`](04-capability-artifact.md) — capability schema, tenant overrides, repository API, filesystem catalog, targeting, versioning.
5. [`05-replay-engine.md`](05-replay-engine.md) — deterministic replay, result taxonomy, waits/retries, assisted fallback.
6. [`06-multi-tenant-and-adaptation.md`](06-multi-tenant-and-adaptation.md) — Vendor → Product → Tenant, reuse, drift, `icas-adapt`.
7. [`07-human-handoff.md`](07-human-handoff.md) — CLI approval/input, browser takeover, ownership, intervention contracts.
8. [`08-safety-policy.md`](08-safety-policy.md) — injectable prompt policy, runtime allowlist, risky actions, redaction boundary.
9. [`09-evidence-observability.md`](09-evidence-observability.md) — discovery traces, replay logs, screenshots, JSONL, run history.
10. [`10-surface-abstraction.md`](10-surface-abstraction.md) — browser implementation and future desktop/accessibility seam.
11. [`11-agent-facing-mcp.md`](11-agent-facing-mcp.md) — `icas-mcp`, capability catalog as tools, MCP adapter design.
12. [`12-testing-and-demo.md`](12-testing-and-demo.md) — targeted tests and the end-to-end review/demo path.

`brief.pdf` may exist locally as the take-home prompt. It is gitignored and must not be committed.

## Working rule

When implementation changes an architectural decision, update the relevant design note first or in the same change. Avoid letting the code become the only source of truth for behavior that a reviewer must understand and defend.
