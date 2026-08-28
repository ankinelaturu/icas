# Run Evidence

Evidence is run-scoped, not capability-scoped state. A capability can have many discovery, replay, and adaptation runs over time.

Recommended shape:

```text
evidence/
└── loan-payoff/
    ├── discovery-<run-id>/
    │   ├── trace.jsonl
    │   ├── summary.json
    │   └── observations/
    ├── replay-<run-id>/
    │   ├── log.jsonl
    │   └── summary.json
    └── replay-<exception-run-id>/
        ├── log.jsonl
        ├── summary.json
        └── failure.png
```

Discovery evidence should be rich enough to prove a genuine LLM-driven observe → decide → act run. Successful replay can be lighter; failures and HITL should capture richer context.

All persisted evidence must pass through the configured Redactor.
