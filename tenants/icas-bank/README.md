# ICAS Bank — synthetic tenant

The large banner is the **institution** (`ICAS BANK`). Vendor/product chrome matches Loki: `Vendor: ICAS BANK`, `Product: LS 4.12.08`, `Licensed product: ICAS BANK CORE`.

Same fictional vendor product as `tenants/loki-bank` (label-drift twin on `:4102`).

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

## Injectable overlays

Query `inject` (cookie-backed so it survives navigation). Overlay appears on **Loan Details**, not search.

Optional `message=` is stored on a second cookie. Use it so HITL body text can match a compiled `possibleOutcomes` phrase after Home → Inquire (the query string is dropped). Wait accepts the same param for future tests; omit it to keep the default “Please wait” copy.

URL-encode the phrase (`encodeURIComponent` in a shell, or a browser address bar).

| Start URL | What happens |
|---|---|
| `http://localhost:4101/?inject=wait` | Session warning + Continue (recoverable; ~400ms delay) |
| `http://localhost:4101/?inject=wait&message=…` | Same heading and Continue; custom body |
| `http://localhost:4101/?inject=hitl` | Manual review; **Release to servicing** (do not click Continue) |
| `http://localhost:4101/?inject=hitl&message=…` | Custom body; dismiss link is **human interacted** |
| no query | Happy path |

Example HITL (encode the spaces):

`http://localhost:4101/?inject=hitl&message=Permission%20required%20to%20access%20loan%20details`

Continue / Release / human interacted request `inject=clear` and drop both cookies. Setting `inject=wait` or `inject=hitl` without `message=` also drops a leftover phrase cookie.
