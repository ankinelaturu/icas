# ICAS Banc — synthetic tenant

Near-copy of `tenants/icas-bank` for a **one-control** same-product variant.

The large banner is the **institution** (`ICAS BANC`). Vendor/product chrome stays the icas-bank family: `Vendor: ICAS BANK`, `Product: LS 4.12.08`, `Licensed product: ICAS BANK CORE`.

- Catalog: `--vendor icas-bank --product icas-bank --tenant icas-banc`
- URL: `http://localhost:4104`
- Layout: same table shell and routes as icas-bank; maroon/red skin; no test IDs
- **Flow drift:** search submit is **Look Up** (icas-bank is **Inquire**). Everything else on the payoff path matches.

`icas-play` still requires an enrolled override for `icas-banc`. This app does not create one.

## Run

```bash
pnpm --filter @icas/icas-banc start
```

## Loan payoff path

Home → Lending → Loan Account Inquiry → **Look Up** (`LN Acct #`) → Loan Details → Payoff → Payoff Dt → Calculate / Generate → Payoff Statement

Known accounts match icas-bank (processing date **2026-08-28**): `987654`, `112233`, `555555`, plus not-found.

## Injectable overlays

Same `inject` / `message=` query as icas-bank. Overlay appears on **Loan Details**. Start URLs use port **4104**.
