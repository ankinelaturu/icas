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
- model decision/rationale and ranked candidates (full actions);
- chosen action;
- policy decision;
- action result;
- dead-end assessment;
- backtrack;
- intervention request;
- human action;
- success.

`icas-agent discover` prints the same loop to stderr (snapshot preview + LLM JSON) so a live run is inspectable without opening `trace.jsonl` first.

## Replay evidence

Every replay (and adaptation verification that uses `ReplayEngine`) writes a structured execution log plus a summary, regardless of terminal status.

```text
evidence/<capability>/<run-id>/
├── log.jsonl
├── summary.json
└── observations/          # failure, HITL, and business-outcome stops
```

`log.jsonl` records checkpoints as they happen:

```text
run_start
step N precondition ✓|✗
policy decision
step N action ✓|✗          # type "action" (deterministic)
step N postcondition ✓|✗
possible_outcome           # next locator missed; any match.phrases hit (error or hitl)
recovery                   # known interstitial, if any
assisted_fallback          # `--assist` only; not a deterministic action
success_check / outputs
result SUCCESS | business_outcome | failure
handoff_start … handoff_end  # HITL, actor: human
```

Successful replay does not attach screenshots. Failures, HITL pauses, and business-outcome stops add a screenshot and DOM snapshot under `observations/`.

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
