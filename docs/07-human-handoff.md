# 07 — Human Handoff

## Meaning of handoff

Handoff means **automation → human control transfer of the same live session**, followed by an explicit return of control. It is not merely asking a human a question and it is not opening a fresh browser.

## Two HITL interaction forms

### 1. Human input / approval via CLI

Example:

```text
The application requires a payoff reason:
1. Refinance
2. Sale
3. Other

Selection: _
```

or:

```text
Generate the official payoff statement? [y/N]
```

This is useful when automation understands the next step but requires information/authorization.

### 2. Browser takeover

Example:

```text
⚠ HUMAN INTERVENTION REQUIRED
Reason: unexpected manual-review screen
Automation is paused.
Use the existing browser window to resolve the issue.
Press ENTER here when finished.
```

The human operates the exact browser session already controlled by Playwright.

## Ownership state

Ownership should be explicit:

```ts
type ControlOwner = "automation" | "human";
```

Transitions:

```text
automation
  → request intervention
human
  → resume signal
automation
```

No automation action should execute while ownership is `human`.

## Intervention contract

```ts
interface InterventionRequest {
  runId: string;
  reason:
    | "approval_required"
    | "discovery_stuck"
    | "unexpected_state"
    | "policy_block"
    | "hard_failure_recovery";
  message: string;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  observationRef?: string;
}
```

The request carries enough context for an operator to act without reconstructing the run from scratch.

## Recording human actions

During browser handoff, automation stops issuing actions but instrumentation remains active. Human actions should be tagged separately in evidence:

```json
{
  "actor": "human",
  "type": "click",
  "target": { "text": "Manual Review Complete" }
}
```

At minimum record:

- handoff start;
- state/observation before;
- human action(s) or state transition where observable;
- resume signal;
- state after;
- handoff end.

## Capability compilation after handoff

Do not automatically compile every human action into the reusable capability.

- Normal recurring approval boundary → may become an explicit `handoff`/approval step.
- Exceptional manual recovery → generally remains evidence and is not inserted into the normal deterministic path.

## Why no operator console app is required

A production system might stream a remote browser into a supervisor console and send remote keyboard/mouse input back to a worker. That real-time co-browsing infrastructure is outside this prototype. A local headed browser provides the same control-transfer semantics without building streaming/transport infrastructure.

The important seam is the HandoffController, not a polished operator UI.
