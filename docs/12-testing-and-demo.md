# 12 — Testing and Demo Plan

## Philosophy

Test the contracts and failure boundaries that matter. Do not spend effort unit-testing framework internals.

## Package-level tests

### Capability

- schema validation;
- input/output type validation;
- invalid artifact rejection;
- schema vs capability version handling.

### Replay

- precondition evaluation;
- action execution sequencing;
- postcondition evaluation;
- output extraction;
- business outcome classification;
- recoverable retry behavior;
- hard-failure reporting;
- assisted fallback re-entry rules.

### Policy

- allowed action passes;
- unsupported action denied;
- off-origin navigation denied;
- risky action requires human.

### Redactor

- configured values/patterns masked;
- unconfigured content preserved;
- separate profiles behave independently.

### Handoff

- automation → human ownership transition;
- no automation action while human owns control;
- resume returns ownership;
- intervention payload contains required context.

## Cross-package integration tests

Suggested top-level tests:

```text
tests/integration/
  discovery-to-capability.test.ts
  capability-replay.test.ts
  loan-not-found.test.ts
  assisted-fallback.test.ts
  tenant-adaptation.test.ts
```

## End-to-end scenarios

### 1. Real discovery

- start Tenant A;
- launch `icas-agent discover --id loan-payoff --url … --goal …`;
- model navigates the real UI;
- capability is written;
- discovery trace + observations are written.

### 2. Deterministic replay with different input values

- invoke the generated capability through `icas-play`;
- use a different loan/date than the discovery run;
- verify success and declared outputs;
- no model decisions.

### 3. Business outcome

- run with a nonexistent synthetic loan;
- return `LOAN_NOT_FOUND` as `business_outcome`, not a Playwright exception.

### 4. Recoverable condition

- inject a transient load/interstitial;
- demonstrate bounded recovery.

### 5. Human handoff

- inject an ambiguous/manual-review state or risky approval boundary;
- automation pauses;
- operator uses same browser;
- actions/state change are recorded;
- automation resumes.

### 6. Tenant adaptation

- Tenant B runs same fictional Vendor+Product but has a small UI variation;
- guarded replay detects the mismatch;
- `icas-adapt` specializes the affected region and proves re-entry.

### 7. MCP invocation

- launch/configure an MCP-capable agent host;
- agent discovers the generated `loan_payoff` tool;
- invoke it with typed args;
- execution flows through ReplayEngine.

## Reviewer demo commands

Root README should contain exact reproducible commands. Avoid requiring undocumented manual setup.

## Evidence expected in repository

At minimum:

- saved example capability;
- discovery trace;
- successful replay log;
- exceptional replay log;
- rich failure signal where relevant;
- handoff evidence;
- optional short screen recording.
