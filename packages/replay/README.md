# @icas/replay

Deterministic capability execution, checkpoints, result taxonomy, retries, and optional assisted fallback.

`ReplayEngine` receives an **effective** capability only. It never branches on tenant. `run` returns a structured `ExecutionResult` with a `runId`. When an `EvidenceWriter` is injected, every terminal status writes `log.jsonl` plus `summary.json` (checkpoints, HITL, assist, result). Cross-package HTML-fixture tests live in `tests/integration/` (`pnpm test:integration`).
