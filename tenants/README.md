# Synthetic tenant apps

These are **staff** back-office demos for ICAS discovery and replay. Not consumer banking. No login. No real PII. Each folder is its own install — they do not share a `tenants/core` package.

| App | URL | Catalog | Purpose |
|---|---|---|---|
| [`icas-bank`](icas-bank/) | `http://localhost:4101` | `--vendor icas-bank --product icas-bank --tenant icas-bank` | First institution. Table layout. Loan payoff happy path + `LOAN_NOT_FOUND`. `?inject=wait\|hitl` overlay on **Loan Details**. |
| [`loki-bank`](loki-bank/) | `http://localhost:4102` | `--vendor icas-bank --product icas-bank --tenant loki-bank` | Same Vendor+Product as icas-bank with CU chrome and **label drift** for `icas-adapt`. Same inject query; overlay on **Find a Loan**. |
| [`helix-cu`](helix-cu/) | `http://localhost:4103` | `--vendor helix --product helix --tenant helix-cu` | Different vendor/product. **Div** layout. Share-hold path for a second `--goal` / `--id share-hold`. |

Start one tenant per terminal (`pnpm icas-bank`, `pnpm loki-bank`, `pnpm helix-cu`). Do not hand-author `capabilities/` for these UIs — artifacts come from a real discover run.
