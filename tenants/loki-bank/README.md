# Loki Bank — synthetic tenant

The large banner is the **institution** (`LOKI BANK`). The licensed vendor product stays **ICAS BANK CORE** (same as `tenants/icas-bank`) in the vendor/product line and subbar.

- Vendor: **ICAS BANK**
- Product: **ICAS BANK CORE** / LS 4.12.08
- Tenant: **loki-bank** (Institution 9902)

Same payoff workflow and loan records. Different CU skin (green/gold) and **label drift** so an icas-bank capability fails guarded replay until `icas-adapt` patches it.

- Catalog: `--vendor icas-bank --product icas-bank --tenant loki-bank`
- URL: `http://localhost:4102`
- Layout: same table shell and routes; no test IDs

## Run

```bash
pnpm --filter @icas/loki-bank start
```

## Label drift vs icas-bank

| icas-bank | loki-bank |
|---|---|
| Lending | Member Lending |
| Loan Account Inquiry | Loan Servicing |
| Inquire | Search |
| LN Acct # | Loan # |

Payoff statement field labels stay the same (`Total Payoff Amount`, `Principal Balance`, `Per Diem Interest`) so extraction still matches after adapt.

## Path

Home → Member Lending → Loan Servicing → Search (`Loan #`) → Loan Details → Payoff → Payoff Dt → Calculate / Generate → Payoff Statement

Known accounts match icas-bank (`987654`, `112233`, `555555`, plus not-found).

## Injectable overlays

Same `inject` query as icas-bank. **Wait** overlay appears on **Find a Loan** (search). **HITL** overlay appears on the payoff **statement** (after Calculate/Generate).

| Start URL | What happens |
|---|---|
| `http://localhost:4102/?inject=wait` | Session warning + Continue on search |
| `http://localhost:4102/?inject=hitl&message=Authorization%20required` | Manual review on the statement; dismiss **human interacted** |
| no query | Happy path |
