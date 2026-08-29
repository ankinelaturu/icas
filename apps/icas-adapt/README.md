# icas-adapt

Cross-tenant capability adaptation CLI using guarded replay plus bounded discovery.

```text
pnpm icas-adapt loan-payoff --tenant loki-bank --url <url> --loanAccountId … --payoffDate …
```

Enrollment is kept only after `CapabilityResolver` + `ReplayEngine` re-verify the effective capability. A failed re-verify rolls the override back.
