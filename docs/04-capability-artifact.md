# 04 — Capability Artifact

## Purpose

A capability is a typed, serializable, versioned contract describing how to perform a known business operation against a Vendor+Product target. It is not a raw recording and not an LLM transcript.

## Identity

```ts
interface CapabilityArtifact {
  schemaVersion: string;
  capabilityVersion: string;
  id: string;
  name: string;
  target: {
    vendor: string;
    product: string;
  };
  ...
}
```

Vendor+Product identifies the underlying application family. Tenant identity belongs to compatibility/verification metadata rather than being treated as the universal capability identity.

The artifact may record where it was discovered:

```ts
discoveredOn?: {
  tenant: string;
  url?: string;
}
```

but a reusable capability must not bake the tenant's concrete origin into every route or target.

## Base capability and tenant specialization

A normal capability remains identified by Vendor+Product. Tenant identity is not part of that reusable identity.

Tenant-specific differences should be represented as a specialization artifact that references a specific base capability and version. Do not duplicate the full capability when only a few steps differ. Overrides must remain serializable, reviewable data — not arbitrary executable JavaScript.

```ts
interface CapabilityOverride {
  schemaVersion: string;
  id: string;
  baseCapability: string; // e.g. "loan-payoff@1.0.0"

  target: {
    tenant: string;
  };

  overrides: {
    steps?: Record<string, StepOverride>;
    insertBefore?: Record<string, CapabilityStep[]>;
    insertAfter?: Record<string, CapabilityStep[]>;
    disabledSteps?: string[];
  };

  provenance: {
    createdBy: "icas-adapt" | "human";
    createdFromRun?: string;
    reason: string;
  };
}
```

`StepOverride` may:

- replace a whole step;
- replace only the target/locator;
- replace preconditions;
- replace postconditions.

### Resolution invariant

- base capability + tenant override must be resolved first;
- the resulting effective capability must be schema-validated;
- `ReplayEngine` only receives the resolved effective capability;
- `ReplayEngine` should contain no tenant-specific if/else branches.

## Inputs

Inputs are typed invocation parameters:

```json
{
  "loanAccountId": { "type": "string", "required": true },
  "payoffDate": { "type": "date", "required": true }
}
```

Recorded concrete discovery values must be replaced with parameter references:

```json
{
  "value": { "input": "loanAccountId" }
}
```

not hard-coded values such as `987654`.

## Outputs

Outputs declare the calling contract and extraction target:

```json
{
  "totalPayoffAmount": {
    "type": "money",
    "extract": {
      "target": {
        "strategies": [
          { "type": "label", "label": "Total Payoff Amount" }
        ]
      }
    }
  }
}
```

The replay engine validates extracted values against declared output types before returning success.

## Step model

Each step is roughly:

```ts
interface CapabilityStep {
  id: string;
  description?: string;
  preconditions: Assertion[];
  action: CapabilityAction;
  postconditions: Assertion[];
  timeoutMs?: number;
}
```

### Why both preconditions and postconditions?

They are not necessarily duplicates.

A postcondition answers:

> Did the action I just performed produce the expected result?

A next-step precondition answers:

> Is the current state valid and safe for this specific next action?

Example:

```text
Step: click Search
Postconditions:
- Account # is visible
- Loan Details section is visible
- requested loan ID appears on page

Next step: click Payoff
Preconditions:
- current account ID equals requested loanAccountId
- account status is Active
- Payoff control is present
```

The overlap may be partial, but the semantics and failure attribution differ.

## Assertions/checkpoints

Initial assertion families:

```ts
type Assertion =
  | { type: "textVisible"; value: string | ValueRef }
  | { type: "controlPresent"; target: TargetDescriptor }
  | { type: "valueEquals"; target: TargetDescriptor; value: ValueRef }
  | { type: "urlMatches"; pattern: string }
  | { type: "state"; key: string; value: string | ValueRef };
```

Assertions should encode meaningful state rather than brittle visual equality.

## Actions

Initial action vocabulary:

- click
- fill
- select
- navigate relative path
- read/extract
- handoff

The action contract is semantic enough to map to another surface later, even if Playwright is the first implementation.

## Target / locator representation

Targeting will evolve during implementation. The starting point supports ranked strategies rather than a single selector:

```ts
interface TargetDescriptor {
  strategies: [
    { type: "roleText", role: "button", text: "Payoff" },
    { type: "visibleText", text: "Payoff" },
    { type: "relative", ... }
  ];
}
```

Potential strategies:

- role + text;
- label;
- visible text;
- relative/anchored relationship;
- CSS/XPath fallback where unavoidable;
- normalized coordinates as a last resort.

Raw coordinates discovered from a screenshot must not be treated as a robust production locator by themselves.

## URL representation

Do not persist the tenant's concrete base URL as the reusable capability identity. Runtime target configuration supplies tenant + base URL. Capabilities may contain relative paths or URL patterns where those are meaningful:

```json
{ "type": "urlMatches", "pattern": "/loans/payoff" }
```

## Success condition

The artifact declares an overall success condition in addition to per-step postconditions. For the payoff flow it may require a payoff-statement state plus successful extraction of declared fields.

## Versioning

Keep schema and capability versions separate:

```json
{
  "schemaVersion": "1.0",
  "capabilityVersion": "1.0.0"
}
```

- `schemaVersion` changes when the artifact format/contracts change.
- `capabilityVersion` changes when the learned business flow or targeting/checkpoint behavior changes.

Exact semantic-version policy can remain simple, but the distinction should exist from the beginning.

An override references a specific base capability version (for example `loan-payoff@1.0.0`). If the base version changes, the override must be revalidated before unattended use. Never silently apply an override authored against an incompatible base version.

## Reviewability

A human reviewer and an agent/tool adapter should be able to understand:

- what the capability does;
- which Vendor+Product it applies to;
- which inputs it requires;
- which outputs it returns;
- what actions it performs;
- what state it expects before/after each action;
- what constitutes overall success.
