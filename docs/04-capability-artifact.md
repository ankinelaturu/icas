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
    createdBy: "discovery" | "verified" | "icas-adapt" | "human";
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

### Tenant enrollment

Every tenant that has been discovered or verified gets an override file for that capability version — including when the patch is empty.

```text
capabilities/loan-payoff/1.0.0.json
capabilities/loan-payoff/overrides/icas.json      # header only after first discover
capabilities/loan-payoff/overrides/tenant-b.json  # header only if compatible, or a real patch
```

Rules:

- There is still **one** Vendor+Product base. Do not create a second full capability per tenant.
- A header-only override has `overrides: {}`. That is valid. It is the edit surface for later manual tweaks so operators do not edit `1.0.0.json` when they mean one institution.
- First `icas-agent discover` writes the base **and** the discovering tenant's header-only override (`createdBy: "discovery"`).
- `icas-adapt` that finds the base compatible still writes a header-only override (`createdBy: "verified"`). Drift writes a small declarative patch (`createdBy: "icas-adapt"`).
- An empty override is **not** proof the UI still works. `ReplayEngine` remains the authority. Provenance should keep `createdFromRun`.
- `icas-play run` and `icas-mcp` require the tenant override to exist (CLI `--tenant` defaults to `icas`). Missing file means not enrolled — do not silently use the bare base.
- `icas-agent` and `icas-adapt` may load the base with no tenant file in order to **create** that file.

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

## Capability repository

`@icas/capability` is the repository of capability artifacts. It owns everything about capabilities **as data**: schema/types, validation, CRUD against a catalog, tenant overrides, and resolution into an effective capability.

It does not discover, compile from a trace, or execute. Those consume this package:

| Concern | Package |
|---|---|
| Schema, validation, catalog CRUD, resolve | `@icas/capability` |
| Learn a path and compile a new artifact | `@icas/discovery` (`CapabilityCompiler` then `save`) |
| Execute the effective artifact | `@icas/replay` |
| Human / MCP adapters | `icas-play` / `icas-mcp` |

Callers must not glob `capabilities/*.json` themselves.

### Interface vs implementation

`CapabilityRegistry` is the abstract catalog API. Apps, `CapabilityResolver`, and tests depend on the interface, not on paths.

The implemented backend is filesystem-backed and takes a root folder:

```ts
new FileSystemCapabilityRegistry({ root: "/path/to/capabilities" })
```

- Production default: repository-root `capabilities/`
- Tests: a temp directory, never the submission catalog

REST, database, or a nested `CapabilityStorage` layer are **not** implemented. The `CapabilityRegistry` interface is the expansion seam if a remote catalog is ever needed. Do not add `CapabilityRestRegistry` / `CapabilityDBRegistry` in this prototype.

An in-memory registry is allowed later in tests if filesystem tests become noisy. It is not a product backend.

`CapabilityResolver` sits on `CapabilityRegistry`. It computes an effective capability; it is not a stored row and does not care whether the backend is disk or memory.

```text
CapabilityRegistry  (interface: CRUD + query)
      ↑
FileSystemCapabilityRegistry({ root })   ← only backend in this repo
      ↑
CapabilityResolver  (base + enrolled tenant override → effective artifact)
```

### Registry API

Every `save*` schema-validates first. Invalid artifacts are not written. `save` / `saveOverride` are upserts.

```ts
interface CapabilitySummary {
  id: string;
  name: string;
  capabilityVersion: string;
  schemaVersion: string;
  target: { vendor: string; product: string };
}

interface CapabilityRegistry {
  list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]>;
  // latest capabilityVersion per id (what icas-play list / MCP catalog need)

  get(id: string, version?: string): Promise<CapabilityArtifact | undefined>;
  // version omitted → latest capabilityVersion for that id

  save(capability: CapabilityArtifact): Promise<void>;
  // upsert keyed by (id, capabilityVersion)

  remove(id: string, version?: string): Promise<boolean>;
  // version omitted → remove all versions of id
  // included for a complete repository; the demo may not call it

  listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string; // e.g. "loan-payoff@1.0.0"
  }): Promise<CapabilityOverride[]>;

  getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined>;

  saveOverride(override: CapabilityOverride): Promise<void>;
  // keyed by (tenant, baseCapability);
  // reject if the pinned base version is not stored

  removeOverride(tenant: string, baseCapability: string): Promise<boolean>;
}
```

```ts
interface CapabilityResolver {
  resolve(query: {
    id: string;
    version?: string;
    tenant: string;
  }): Promise<CapabilityArtifact>;
}
```

`resolve` behavior for **enrolled** replay (`icas-play run`, `icas-mcp`):

1. load the base capability (fail if missing);
2. load that tenant's override (fail if missing — not enrolled; do not fall back to the bare base);
3. refuse an override whose `baseCapability` version does not match the loaded base (never apply silently);
4. apply the declarative patch (`overrides: {}` is a no-op);
5. schema-validate the effective artifact;
6. return the effective capability.

`icas-agent` / `icas-adapt` may load the base without an override while creating enrollment. After a successful verify or discover they `saveOverride`.

The effective capability is **never written** to disk. Compatibility is still proven by `ReplayEngine`, not by the registry.

Who calls what:

| Caller | Operations |
|---|---|
| `icas-play list` | `list()` |
| `icas-play describe` | `get(id)` |
| `icas-play run` / `icas-mcp` | `resolver.resolve({ id, tenant })` with tenant default `icas`; override must exist |
| `CapabilityCompiler` | `save(base)` + `saveOverride` (header-only for discovering tenant) |
| `icas-adapt` | guarded replay on base; then `saveOverride` (empty or patch) and `resolve` + re-replay |

### On-disk layout

`FileSystemCapabilityRegistry` owns this tree. Tenant identity is not in the base filename.

```text
capabilities/
  loan-payoff/
    1.0.0.json              # base CapabilityArtifact
    overrides/
      icas.json             # header-only after discover --id loan-payoff
      tenant-b.json         # header-only or a real patch
                            # baseCapability: "loan-payoff@1.0.0"
```

- Base file = Vendor+Product knowledge (`target.vendor` / `target.product`, CLI default `icas`).
- Override file = one enrolled tenant, possibly with an empty patch.
- Root is injectable so tests do not touch the submission catalog.
