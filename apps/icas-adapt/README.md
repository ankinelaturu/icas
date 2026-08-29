# icas-adapt

Cross-tenant capability adaptation CLI using guarded replay plus bounded discovery.

```text
pnpm icas-adapt loan-payoff --tenant loki-bank --url <url> --loanAccountId … --payoffDate …
```

After guarded replay, a compatible tenant is enrolled with a header-only override (`createdBy: "verified"`). A one-step UI drift writes a declarative patch (`createdBy: "icas-adapt"`).
