# @icas/replay

Deterministic capability execution, checkpoints, result taxonomy, retries, and optional assisted fallback.

`ReplayEngine` receives an **effective** capability only. It never branches on tenant. `run` returns a structured `ExecutionResult` with a `runId`. Cross-package HTML-fixture tests live in `tests/integration/` (`pnpm test:integration`).
