# icas-play

Human-facing capability catalog and deterministic replay CLI.

```text
pnpm icas-play list
pnpm icas-play describe <id>
```

`list` and `describe` call `CapabilityRegistry`. They do not glob `capabilities/`.
Set `ICAS_CAPABILITIES_ROOT` in tests; production defaults to `./capabilities`.
`describe` prints inputs, outputs, steps, success, and `discoveredOn` as labeled text, not raw JSON.