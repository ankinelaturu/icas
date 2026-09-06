# 06 — Multi-Tenant Model and Adaptation

## Terminology

Use the following hierarchy consistently:

```text
Vendor → Product/App → Tenant
```

- **Vendor**: company that builds banking software.
- **Product/App**: a specific software product from that vendor.
- **Tenant**: one bank or credit union running/configuring that product.

A vendor can have many products. A tenant can use many products from one or more vendors. The same product can be deployed at many tenants.

## Capability identity

A capability learned for a Vendor+Product should be considered reusable knowledge about that app family. It is **not** automatically valid at every tenant running that product.

```text
Vendor+Product capability
        ↓
candidate for tenant reuse
        ↓
verify compatibility
```

## Why same product can differ across tenants

Tenant installations may differ in:

- configuration;
- branding;
- labels;
- enabled modules/features;
- routes/navigation;
- permissions;
- version;
- integrations;
- institution-specific workflows.

Therefore:

```text
same Vendor+Product ≠ identical UI
```

## Reuse model

For `icas-bank` (CLI defaults, tenant id `icas-bank`):

```text
icas-agent discover --id loan-payoff --url … --goal …
→ base capability C
→ header-only override for tenant icas-bank
→ discovery evidence
```

For Loki Bank with same Vendor+Product:

```text
icas-adapt loan-payoff --tenant loki-bank --url …
→ guarded ReplayEngine verification against C
→ success: write header-only override for loki-bank (createdBy: "verified")
→ mismatch: write a small declarative patch and re-verify
```

`tenants/icas-banc` (`:4104`) is the same Vendor+Product with institution chrome and **one** search-submit rename (Inquire → Look Up). It is the intended one-step adapt target. Loki remains the larger-drift twin. Neither tenant is enrolled until `icas-adapt` (or a human) writes `overrides/<tenant>.json`.

A tenant with no override file is not enrolled. `icas-play run` / MCP must not silently use the bare base.

## `icas-adapt`

`icas-adapt` exists to separate tenant specialization from both pure discovery and normal replay.

Input:

- existing capability ID;
- new tenant identity (`--tenant` required here; do not default this to `icas-bank` when specializing a second institution);
- URL/entry point;
- Vendor+Product compatibility context (CLI `--vendor` / `--product` default to `icas-bank`).

Behavior:

1. run guarded replay;
2. stop at the first meaningful mismatch;
3. capture expected vs observed state;
4. invoke bounded discovery/adaptation around the divergent region;
5. prove re-entry into the known downstream path via pre/post conditions;
6. produce a specialized/overridden capability representation (header-only if compatible, patch if a small region drifted);
7. record evidence.

## Base + specialization concept

The implementation may choose one of several storage models later:

```text
base capability
  + tenant override
```

or

```text
specialized capability derived from base
```

The important design property is that tenant specialization should not require duplicating the entire artifact when only a small region differs.

The chosen catalog is `FileSystemCapabilityRegistry` writing base + override JSON as specified in [`04-capability-artifact.md`](04-capability-artifact.md). Derived full copies of the artifact and REST/DB registries are not implemented.

## Tenant override model

Preferred model:

```text
Base capability:
s1 → s2 → s3 → s4 → s5

Loki Bank override:
          s3'

Effective capability:
s1 → s2 → s3' → s4 → s5
```

- The Vendor+Product capability is the reusable base.
- Every enrolled tenant has an override file. If the base works unchanged, the file is **header only** (`overrides: {}`).
- Tenant differences are small declarative patches on that file — never a second full capability.
- Same Vendor+Product means “candidate for reuse,” not “guaranteed compatible.”

Header-only override (compatible or first discovery):

```json
{
  "schemaVersion": "1.0",
  "id": "loan-payoff-icas-bank",
  "baseCapability": "loan-payoff",
  "target": { "tenant": "icas-bank" },
  "overrides": {},
  "provenance": {
    "createdBy": "discovery",
    "reason": "enrolled discovering tenant",
    "createdFromRun": "run-..."
  }
}
```

Example override:

```json
{
  "baseCapability": "loan-payoff",
  "target": {
    "tenant": "loki-bank"
  },
  "overrides": {
    "steps": {
      "s3": {
        "preconditions": [
          { "type": "textVisible", "value": "Member Lending" }
        ],
        "action": {
          "type": "click",
          "target": {
            "strategies": [
              { "type": "visibleText", "text": "Loan Servicing" }
            ]
          }
        },
        "postconditions": [
          { "type": "textVisible", "value": "Loan Details" }
        ]
      }
    }
  }
}
```

Supported override operations:

- replace a complete step;
- replace target/locator only;
- replace preconditions/postconditions;
- insert steps before/after a known step;
- disable/remove a step.

Arbitrary `customJavaScript`-style patches are rejected. Overrides are data, not executable code.

Provenance example:

```json
{
  "tenant": "loki-bank",
  "baseCapability": "loan-payoff",
  "createdBy": "icas-adapt",
  "reason": "step s3 precondition mismatch",
  "createdFromRun": "run-..."
}
```

### Effective capability resolution

```text
base capability
      +
tenant override
      ↓
resolve + validate
      ↓
effective capability
      ↓
ReplayEngine
```

### When an override is not enough

`icas-adapt` should use a small override only if it can prove re-entry into the known downstream path. If divergence spans much of the workflow, downstream preconditions cannot be restored, or the business flow is materially different, stop adaptation and require broader rediscovery instead of accumulating a large brittle patch.

## Drift

Version or tenant drift is detected through checkpoint failure, not through blind execution. A mismatch should fail safely and surface the exact step/state divergence.

Tenant overrides are subject to the same pre/post checkpoint validation as the base capability. Drift in either the base capability or the override should fail at the precise boundary, not silently continue.

## Repository tenant fixtures

`tenants/icas-bank` is the first institution. `tenants/loki-bank` is a separate install of the **same fictional Vendor+Product** (`icas-bank` / `icas-bank`) with CU branding and small label drift. `tenants/helix-cu` is a different vendor/product (`helix` / `helix`) with a div-based share-hold path (not loan payoff).

Both apps accept `?inject=wait` (session warning + Continue) and `?inject=hitl` (manual review; human must release). The query is stored on a cookie so it survives navigation. Overlays sit at **different steps**: loan details on icas-bank, search on Loki Bank. This gives the project a concrete environment for:

- capability reuse;
- guarded replay;
- recoverable interstitial / HITL fixtures (`?inject=`);
- assisted fallback;
- `icas-adapt`;
- drift evidence.
