# icas-play

Human-facing capability catalog and deterministic replay CLI.

```text
pnpm icas-play list
```

`list` calls `CapabilityRegistry.list()`. It does not glob `capabilities/`.
Set `ICAS_CAPABILITIES_ROOT` in tests; production defaults to `./capabilities`.
