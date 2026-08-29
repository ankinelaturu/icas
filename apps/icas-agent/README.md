# icas-agent

Goal-driven discovery CLI. Always performs discovery from a natural-language goal.

```text
pnpm icas-agent discover --id loan-payoff --url <url> --goal "Generate a payoff statement"
```

`--id`, `--url`, and `--goal` are required. `--vendor` / `--product` / `--tenant` default to `icas-bank` and are never inferred from the URL. An existing `--id` is refused unless `--capability-version` is an explicit bump.

On success the compiler writes the base capability and a header-only tenant override (`overrides: {}`).
