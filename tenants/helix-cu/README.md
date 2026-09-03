# Helix CU — synthetic tenant

The large banner is the **institution** (`HELIX CREDIT UNION`). This is a **different** fictional vendor/product from icas-bank / Loki Bank.

- Vendor: **HELIX**
- Product: **HELIX MEMBER OPS** / MS 2.14.03
- Tenant: **helix-cu** (Institution 4401)
- Catalog: `--vendor helix --product helix --tenant helix-cu`

Staff share-hold workflow. Markup is **divs only** (no layout tables). No login. No real PII.

- URL: `http://localhost:4103`

## Run

```bash
pnpm --filter @icas/helix-cu start
```

## Share hold path

Home → Member Services → Share Holds → Find Member (`Member #`) → Member Shares → Primary Share → Hold Amt + Reason → Place Hold → Hold Confirmation

Known members (processing date **2026-09-03**):

| Member # | Short name | Notes |
|---|---|---|
| `441122` | HALE, J | Primary demo. Share `01` Primary Share avail `1840.50`; share `02` Holiday Club |
| `330198` | NGUYEN, P | Second member for replay with different inputs |
| anything else | — | `No member record found` |

Demo hold for `441122` / share `01` / `250.00`: confirmation `HLD-441122-01-25000`, available after `1590.50`, expires `2026-09-10`.

Suggested discovery goal:

```text
Place a $250.00 hold on member 441122 share 01 for pending debit card authorization. Extract the hold confirmation number, available balance after the hold, and the hold expiry date.
```
