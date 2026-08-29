# icas-adapt

Cross-tenant capability adaptation CLI using guarded replay plus bounded discovery.

```text
pnpm icas-adapt loan-payoff --tenant loki-bank --url <url> --loanAccountId … --payoffDate …
```

`--tenant` is required and is never defaulted to `icas-bank`. `--url` only opens the surface. Guarded replay uses the Vendor+Product **base** (the new tenant is not enrolled yet) and stops at the first checkpoint mismatch.
