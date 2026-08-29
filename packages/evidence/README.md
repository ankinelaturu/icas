# @icas/evidence

Run-scoped discovery traces, replay logs, summaries, screenshots, and handoff events.

`FileSystemEvidenceWriter` writes `evidence/<capability>/<run-id>/` with append-only JSONL (`trace.jsonl` for discovery, `log.jsonl` otherwise) and `summary.json`. Tests use a temp directory, never the repo `evidence/` tree.
