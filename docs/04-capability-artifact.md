# 04 — Capability Artifact

## Purpose

A capability is a typed, serializable contract describing how to perform a known business operation against a Vendor+Product target. It is not a raw recording and not an LLM transcript.

## Identity

```ts
interface CapabilityArtifact {
  schemaVersion: string;
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

Tenant-specific differences should be represented as a specialization artifact that references a base capability id. Do not duplicate the full capability when only a few steps differ. Overrides must remain serializable, reviewable data — not arbitrary executable JavaScript.

```ts
interface CapabilityOverride {
  schemaVersion: string;
  id: string;
  baseCapability: string; // catalog id, e.g. "loan-payoff"

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
- replace postconditions;
- replace `possibleOutcomes`.

### Tenant enrollment

Every tenant that has been discovered or verified gets an override file for that capability — including when the patch is empty.

```text
capabilities/loan-payoff/capability.json
capabilities/loan-payoff/overrides/icas-bank.json  # header only after first discover
capabilities/loan-payoff/overrides/loki-bank.json  # header only if compatible, or a real patch
```

Rules:

- There is still **one** Vendor+Product base. Do not create a second full capability per tenant.
- A header-only override has `overrides: {}`. That is valid. It is the edit surface for later manual tweaks so operators do not edit `capability.json` when they mean one institution.
- First `icas-agent discover` writes the base **and** the discovering tenant's header-only override (`createdBy: "discovery"`).
- `icas-adapt` that finds the base compatible still writes a header-only override (`createdBy: "verified"`). Drift writes a small declarative patch (`createdBy: "icas-adapt"`).
- An empty override is **not** proof the UI still works. `ReplayEngine` remains the authority. Provenance should keep `createdFromRun`.
- `icas-play run` and `icas-mcp` require the tenant override to exist (CLI `--tenant` defaults to `icas-bank`). Missing file means not enrolled — do not silently use the bare base.
- `icas-agent` and `icas-adapt` may load the base with no tenant file in order to **create** that file.

### Resolution invariant

- base capability + tenant override must be resolved first;
- the resulting effective capability must be schema-validated;
- `ReplayEngine` only receives the resolved effective capability;
- `ReplayEngine` should contain no tenant-specific if/else branches and no hardcoded product error copy (no engine-level “loan not found” table). Exceptional-state phrases live on the artifact as `possibleOutcomes`.

## Inputs

Inputs are typed invocation parameters on the **compiled** artifact. Replay and MCP pass values by those names. Discovery does not receive a CLI name→literal map. The proposer emits `proposedInputParam` on every fill/select; the compiler aggregates unique names into this object and rewrites step values to `{ "input": "<name>" }`.

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

not hard-coded literals. The names above are an example of a compiled contract for this take-home flow. They are not a closed list in the discovery prompt.

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

Discovery compiles `outputs` from the proposer’s success `result` (caption locators on the completed observation). Discovery does not bind output snapshot refs — a value cell's inner text is this run's data. `read` steps on the success path remain a fallback for traces that predate `result`. Replay does not infer fields from the goal; empty `outputs` yields `outputs: (none)` on `icas-play run`.

## Step model

Each step is roughly:

```ts
interface CapabilityStep {
  id: string;
  description?: string;
  preconditions: Assertion[];
  action: CapabilityAction;
  postconditions: Assertion[];
  possibleOutcomes?: PossibleOutcome[];
  timeoutMs?: number;
}

interface OutcomeMatch {
  phrases: string[]; // 1–3; any one visible → this outcome hits (OR)
}

interface PossibleOutcome {
  kind: "success" | "error" | "hitl";
  match: OutcomeMatch;
  heading: string | null;
  summary: string | null;
}
```

Compiled steps keep `error` and `hitl` entries from the kept candidate, in the same order. `kind: "success"` is not stored.

### `possibleOutcomes` vs checkpoints

A capability is **one** happy-path step list. It does not encode a decision tree of error flows.

`possibleOutcomes` are guessed matchers for when that path **cannot continue**. Replay uses them only after the **next** step’s action locator misses (or after last-step `success` assertions miss) **and** a known interstitial was not dismissed. HTTP 403/404/5xx and generic server chrome are **runtime** catalogs in [`05-replay-engine.md`](05-replay-engine.md). They are not fields on this schema and are not merged into compiled steps.

`match.phrases` is the only field that touches the page. An outcome hits when **any** phrase is visible (OR). `heading` and `summary` are the formatted result for the calling tool and for HITL context. A screenshot still goes to evidence on that stop.

Do not persist embedding vectors in the artifact. Phrases stay reviewable text. A later matcher may embed page text and compare it to those phrases; that is still deterministic replay (no LLM). See [`05-replay-engine.md`](05-replay-engine.md).

A `textVisible` precondition that repeats the click target is redundant with the action locator. `possibleOutcomes` are not preconditions.

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
    { type: "relative", text: "Amount due", xpath: "following::input[1]" },
    { type: "css", selector: "#legacy-grid" },
    { type: "xpath", selector: "//*[@id='legacy-grid']" },
    { type: "coordinates", x: 12, y: 12 }
  ];
}
```

`relative` anchors on visible `text`, then optionally a `role` or `xpath` from that node. With neither, it takes the nearest following `input` / `textarea` / `select`, or a `td` that does **not** wrap a form control. Inquiry rows are caption `td` + value `td` around an input; a bare following-`td` would fill the wrapper. Statement amount cells have no control, so they still match. `coordinates` is last-resort only.

Discovery may propose a snapshot `ref` (`e12`). That token is not a catalog strategy. Discovery executes the ref, then keeps the model's locator phrases and may append bind CSS/`label` identity. Live accessible names are not copied: they concatenate this run's balances and ids. Replay matches `roleText` / `visibleText` as a substring of the accessible name so a chrome phrase still hits a data tile. Replay never uses the ref.

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

The artifact declares an overall success condition in addition to per-step postconditions. Compile copies proposer `successSignals`. The discovery prompt (`REPLAY MATCHERS`) requires the longest contiguous snapshot substring with no instance tokens (not the quoted name as-is); compile does not rewrite or scan those strings.

## Versioning

This prototype stores **one base file per `--id`**. Catalog identity is `id`. Tenant differences live on overrides.

- `schemaVersion` is the JSON format (`"1.0"`). A schema upgrade migrates every file in place; do not keep parallel schema trees.
- There is no operator-facing flow version: no `capabilityVersion` field, no `--capability-version`, no play/adapt `--version`.
- An override pins `baseCapability` to the catalog id (for example `"loan-payoff"`). Header-only `overrides: {}` still enrolls.
- Discover refuses an existing `--id`. Choose a new id rather than bumping a version.

**Future:** if a base edit must not leak to every enrolled tenant, introduce a second base file and an `@version` pin. That is not in filenames or CLI now.

## Reviewability

A human reviewer and an agent/tool adapter should be able to understand:

- what the capability does;
- which Vendor+Product it applies to;
- which inputs it requires;
- which outputs it returns;
- what actions it performs;
- what state it expects before/after each action;
- what `possibleOutcomes` it may report when the happy path cannot continue;
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
  schemaVersion: string;
  target: { vendor: string; product: string };
}

interface CapabilityRegistry {
  list(filter?: {
    vendor?: string;
    product?: string;
  }): Promise<CapabilitySummary[]>;
  // one row per id (what icas-play list / MCP catalog need)

  get(id: string): Promise<CapabilityArtifact | undefined>;

  save(capability: CapabilityArtifact): Promise<void>;
  // upsert keyed by id (`capability.json`)

  remove(id: string): Promise<boolean>;
  // remove the id directory, including tenant overrides
  // included for a complete repository; the demo may not call it

  listOverrides(filter?: {
    tenant?: string;
    baseCapability?: string; // catalog id, e.g. "loan-payoff"
  }): Promise<CapabilityOverride[]>;

  getOverride(
    tenant: string,
    baseCapability: string,
  ): Promise<CapabilityOverride | undefined>;

  saveOverride(override: CapabilityOverride): Promise<void>;
  // keyed by (tenant, baseCapability);
  // reject if the named base is not stored

  removeOverride(tenant: string, baseCapability: string): Promise<boolean>;
}
```

```ts
interface CapabilityResolver {
  resolve(query: {
    id: string;
    tenant: string;
  }): Promise<CapabilityArtifact>;
}
```

`resolve` behavior for **enrolled** replay (`icas-play run`, `icas-mcp`):

1. load the base capability (fail if missing);
2. load that tenant's override (fail if missing — not enrolled; do not fall back to the bare base);
3. refuse an override whose `baseCapability` does not match the loaded base id (never apply silently);
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
| `icas-play run` / `icas-mcp` | `resolver.resolve({ id, tenant })` with tenant default `icas-bank`; override must exist |
| `CapabilityCompiler` | `save(base)` + `saveOverride` (header-only for discovering tenant) |
| `icas-adapt` | guarded replay on base; then `saveOverride` (empty or patch) and `resolve` + re-replay |

### On-disk layout

`FileSystemCapabilityRegistry` owns this tree. Tenant identity is not in the base filename.

```text
capabilities/
  loan-payoff/
    capability.json          # base CapabilityArtifact
    overrides/
      icas-bank.json         # header-only after discover --id loan-payoff
      loki-bank.json         # header-only or a real patch
                            # baseCapability: "loan-payoff"
```

- Base file = Vendor+Product knowledge (`target.vendor` / `target.product`, CLI default `icas-bank`).
- Override file = one enrolled tenant, possibly with an empty patch.
- Root is injectable so tests do not touch the submission catalog.
