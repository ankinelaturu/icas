# Run Evidence

Evidence is run-scoped, not capability-scoped state. A capability can have many discovery, replay, and adaptation runs over time.

Recommended shape:

```text
evidence/
└── loan-payoff/
    ├── <discovery-run-id>/
    │   ├── trace.jsonl
    │   ├── summary.json
    │   └── observations/
    ├── <replay-run-id>/
    │   ├── log.jsonl
    │   └── summary.json
    └── <replay-exception-run-id>/
        ├── log.jsonl
        ├── summary.json
        └── observations/
```

Discovery evidence should be rich enough to prove a genuine LLM-driven observe → decide → act run. Every replay writes `log.jsonl` plus `summary.json` (success, business outcome, failure, HITL). Failures, HITL, and business-outcome stops also capture observations.

All persisted evidence must pass through the configured Redactor.
