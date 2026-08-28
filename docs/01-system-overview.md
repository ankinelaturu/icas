# 01 — System Overview

## Purpose

ICAS (Interface Computer-Use Automation System) is a small computer-use runtime for legacy banking applications that do not expose useful APIs. Its central idea is to spend model reasoning only while a workflow is unknown, then compile the successful discovery into a reusable capability that can execute deterministically afterward.

The design follows this invariant:

```text
The model discovers.
The artifact becomes the reusable capability.
Replay executes the known capability.
```

## Primary use case

The first concrete capability is a synthetic internal banking workflow:

> Generate a formal loan payoff statement for a loan account and a specified future payoff date.

Inputs:

- `loanAccountId`
- `payoffDate`

Expected outputs:

- `totalPayoffAmount`
- `principalBalance`
- `perDiemInterest`

A representative UI path might be:

```text
Home
  → Lending
  → Loan Search
  → Loan Details
  → Payoff
  → enter payoff date
  → Calculate / Generate
  → Payoff Statement
```

The agent is never allowed to hard-code this path. Discovery begins with the goal, target metadata, and entry URL, observes the actual UI, and determines the path at runtime.

## Runnable entry points

### `icas-agent`

Goal-oriented authoring/discovery tool. It always performs genuine LLM-driven discovery. It accepts:

- vendor
- product
- tenant
- URL/entry point
- natural-language goal

It observes the live surface, asks the model to rank/propose actions, executes permitted actions, handles bounded exploration/backtracking, records a discovery trace, and compiles the successful path into a capability artifact.

### `icas-play`

Capability-oriented human CLI. It provides a capability catalog and deterministic execution:

```text
icas-play list
icas-play describe <capability>
icas-play run <capability> ...typed inputs...
```

Strict replay is model-free. An explicit assisted mode may perform one bounded, policy-checked LLM repair at a failed step, then must verify that execution has rejoined the original deterministic path.

### `icas-adapt`

Cross-tenant specialization tool. It takes a known capability for a Vendor+Product and tests it against another tenant running the same product. Guarded replay determines compatibility. If the known route diverges, bounded discovery can specialize the capability rather than rediscovering everything from scratch.

### `icas-mcp`

Agent-facing adapter. It exposes saved capabilities as typed MCP tools so another agent can discover and invoke them by name. Tool execution delegates to the same replay engine used by `icas-play`.

## Shared runtime

```text
                        Capability Registry
                         /       |        \
                        /        |         \
               icas-play    icas-mcp     icas-adapt
                   |            |             |
                   +-------- ReplayEngine ----+
                                |
                     policy / redaction / HITL
                                |
                            Surface API
                                |
                       PlaywrightSurface
                                |
                         Tenant application

icas-agent
   |
DiscoveryAgent (Mastra + bounded search)
   |
Surface API + policy + evidence + handoff
   |
Trace
   |
CapabilityCompiler
   |
Capability Registry
```

## Core design principles

### 1. Determinism before intelligence

If a known capability exists, production execution should prefer deterministic replay. LLM reasoning is not a substitute for a stable execution contract.

### 2. A capability is not a transcript

Discovery evidence can contain failed branches, model decisions, human intervention, and retries. The capability contains only the reusable executable contract.

### 3. Guarded replay

Replay validates current state before acting and validates resulting state afterward. This provides safety, debuggability, and a basis for tenant compatibility detection.

### 4. Same Vendor+Product is a reuse hint, not proof

Two tenants may run the same vendor product while differing in configuration, branding, module enablement, labels, routes, permissions, and version. Reuse must be verified.

### 5. Human handoff is control transfer

HITL is not only a yes/no prompt. When automation cannot safely continue, the same live browser session can be ceded to a human and later resumed.

### 6. Safety is layered

Prompt policy influences what the model proposes. Runtime policy controls what may actually execute. Redaction independently controls what data may leave memory or be persisted.

### 7. Surface independence

The artifact should express semantic actions, targets, assertions, and outputs. Playwright is one surface implementation, not the definition of the artifact model.
