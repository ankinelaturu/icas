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

For Tenant A:

```text
icas-agent
→ discover loan-payoff
→ capability C
→ mark discovery/verification evidence for Tenant A
```

For Tenant B with same Vendor+Product:

```text
capability C
→ guarded ReplayEngine verification
→ success: C is compatible with Tenant B
→ mismatch: adaptation required
```

## `icas-adapt`

`icas-adapt` exists to separate tenant specialization from both pure discovery and normal replay.

Input:

- existing capability ID;
- new tenant identity;
- URL/entry point;
- Vendor+Product compatibility context.

Behavior:

1. run guarded replay;
2. stop at the first meaningful mismatch;
3. capture expected vs observed state;
4. invoke bounded discovery/adaptation around the divergent region;
5. prove re-entry into the known downstream path via pre/post conditions;
6. produce a specialized/overridden capability representation;
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

## Drift

Version or tenant drift is detected through checkpoint failure, not through blind execution. A mismatch should fail safely and surface the exact step/state divergence.

## Repository tenant fixtures

`tenants/tenant-a` and `tenants/tenant-b` should eventually model two institutions running the **same fictional Vendor+Product** with small but meaningful UI differences. This gives the project a concrete environment for:

- capability reuse;
- guarded replay;
- assisted fallback;
- `icas-adapt`;
- drift evidence.
