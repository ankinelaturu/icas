# icas-play

Human-facing capability catalog and deterministic replay CLI.

```text
pnpm icas-play list
pnpm icas-play describe <id>
pnpm icas-play run <id> --url <url> --loanAccountId … --payoffDate …
```

Catalog commands call `CapabilityRegistry`. They do not glob `capabilities/`.
Set `ICAS_CAPABILITIES_ROOT` in tests; production defaults to `./capabilities`.
`describe` prints inputs, outputs, steps, success, and `discoveredOn` as labeled text, not raw JSON.

`run` requires `--url` (browser entry only). `--tenant` / `--vendor` / `--product` default to `icas-bank` and are never inferred from the URL. The tenant must already be enrolled. Strict replay is model-free (`ReplayEngine` with no LLM). `--assist` injects one bounded Mastra repair in this app; `@icas/replay` stays model-free. Replay writes `log.jsonl` plus `summary.json` under `ICAS_EVIDENCE_ROOT` (default `./evidence`).