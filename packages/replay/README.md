# @icas/replay

Deterministic capability execution, checkpoints, result taxonomy, retries, and optional assisted fallback.

`ReplayEngine` receives an **effective** capability only. It never branches on tenant. `run` returns a structured `ExecutionResult` with a `runId`.
