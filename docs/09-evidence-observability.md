# 09 — Evidence and Observability

## Principle

Evidence is run-scoped. A capability is persistent knowledge; every discovery/replay/adaptation execution is a run with its own evidence.

```text
capability-a
  ├── discovery run → evidence
  ├── replay run #1 → evidence
  ├── replay run #2 → evidence
  └── adaptation run → evidence
```

## Discovery evidence

Discovery requires the richest trace because it must prove genuine LLM-driven behavior.

Recommended contents:

```text
evidence/<capability>/<run-id>/
├── trace.jsonl
├── summary.json
└── observations/
    ├── step-001.png
    ├── step-002.png
    └── ...
```

Trace events may include:

- observation captured;
- model decision/rationale;
- candidate ranking;
- chosen action;
- policy decision;
- action result;
- dead-end assessment;
- backtrack;
- intervention request;
- human action;
- success.

## Replay evidence

Successful deterministic replay generally needs only a structured execution log + summary:

```text
step 1 precondition ✓
step 1 action ✓
step 1 postcondition ✓
...
outputs extracted ✓
result SUCCESS
```

Failures and HITL runs should add a richer signal such as a screenshot or surface snapshot at the failure boundary.

## JSONL

`trace.jsonl` / `log.jsonl` uses one JSON object per line. This is convenient for append-only events during long-running execution and avoids keeping an entire trace in memory until completion.

Example:

```jsonl
{"type":"observation","step":1,"page":"home"}
{"type":"agent_decision","step":1,"action":"click","target":"Lending"}
{"type":"action_result","step":1,"status":"success"}
```

## Summary

A run summary is a compact whole-run object:

```json
{
  "runId": "run-20260828-001",
  "runType": "discovery",
  "capabilityId": "loan-payoff",
  "status": "success",
  "steps": 11,
  "backtracks": 1
}
```

## Redaction

EvidenceWriter must pass persistable text/structured payloads through Redactor before disk persistence. Do not duplicate redaction rules inside the evidence package.

Potential profiles may differ between:

- what can be sent to the model;
- what can be persisted in evidence;
- what can be emitted to terminal logs.

## Assisted fallback evidence

A one-step LLM repair during replay must be visible in evidence and clearly distinguished from deterministic actions.

## Multi-run stability

Because runs are separately represented, optional stability metrics can be computed later from repeated replay results without changing the core evidence model.
