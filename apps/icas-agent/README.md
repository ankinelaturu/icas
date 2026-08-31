# icas-agent

Goal-driven discovery CLI. Always performs discovery from a natural-language goal.

```text
pnpm icas-agent discover --id loan-payoff --url <url> --goal "Generate a payoff statement"
```

`--id`, `--url`, and `--goal` are required. `--vendor` / `--product` / `--tenant` default to `icas-bank` and are never inferred from the URL. An existing `--id` is refused unless `--capability-version` is an explicit bump. Put values to type in `--goal`. Discover does not take `--loanAccountId`-style flags; the proposer names params and the compiler aggregates them.

On success the compiler writes the base capability and a header-only tenant override (`overrides: {}`).

Discover prints live progress to stderr: observation snapshots, agent instructions (once), each LLM user prompt, the LLM proposal JSON, chosen actions, and surface errors. Evidence still lands under `ICAS_EVIDENCE_ROOT` (default `./evidence`).

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ICAS_MODEL` are read from the process env. When those keys are empty, the CLI loads repo-root `.env` (so `pnpm --filter @icas/agent exec` still works). A non-empty shell export is not overwritten.
