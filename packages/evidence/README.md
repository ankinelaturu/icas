# @icas/evidence

Run-scoped discovery traces, replay logs, summaries, screenshots, and handoff events.

`FileSystemEvidenceWriter` writes `evidence/<capability>/<run-id>/` with append-only JSONL (`trace.jsonl` for discovery, `log.jsonl` otherwise), `summary.json`, and `observations/`. Payloads pass through the evidence-profile `Redactor` before disk. Tests use a temp directory, never the repo `evidence/` tree.

Each JSONL event is stamped with `runType` (`discovery` | `replay` | `adaptation`) and may tag `actor` (`agent` | `replay` | `human`). Assisted LLM repair uses `assisted_fallback`, not `action`.
