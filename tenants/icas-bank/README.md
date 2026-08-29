# ICAS Bank — synthetic tenant

Local stand-in for one institution running the fictional **icas-bank** vendor product. No login. No real PII.

- Catalog: `--vendor icas-bank --product icas-bank --tenant icas-bank` (CLI defaults)
- URL: `http://localhost:4101`
- Layout: table-based HTML, separate `public/styles.css`, no test IDs

## Run

```bash
pnpm --filter @icas/icas-bank start
```

## Loan payoff path

Home → Lending → Loan Account Inquiry → Inquire (`LN Acct #`) → Loan Details → Payoff → Payoff Dt → Calculate / Generate → Payoff Statement

Known accounts (processing date **2026-08-28**):

| LN Acct # | Status | Notes |
|---|---|---|
| `987654` | Active | Primary demo loan |
| `112233` | Active | Second loan for replay with different inputs |
| `555555` | Paid Off | Inquiry works; payoff quote is refused |
| anything else | — | `No loan record found` (business empty state, not a crash) |

Demo quote for `987654` / `2026-09-30`: principal `12450.00`, per diem `3.45`, 33 days, total `12563.85`.
