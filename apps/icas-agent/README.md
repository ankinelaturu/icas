# icas-agent

Goal-driven discovery CLI. Always performs discovery from a natural-language goal.

```text
pnpm icas-agent discover --id loan-payoff --url <url> --goal "Generate a payoff statement"
```

`--id`, `--url`, and `--goal` are required. `--vendor` / `--product` / `--tenant` default to `icas-bank` and are never inferred from the URL. An existing `--id` is refused. Put values to type in `--goal`. Discover does not take `--loanAccountId`-style flags; the proposer names params and the compiler aggregates them.

On success the compiler writes the base capability and a header-only tenant override (`overrides: {}`).

Discover prints live progress to stderr: observation snapshots, agent instructions (once), each LLM user prompt, the LLM proposal JSON, chosen actions, and surface errors. Evidence still lands under `ICAS_EVIDENCE_ROOT` (default `./evidence`).

Model settings are `ICAS_DISCOVERY_LLM_*` (`MODEL`, `API_KEY`, optional `BASE_URL`, sampling). `MODEL` is `provider/model` (default `openai/gpt-4o`). Leave `BASE_URL` empty for hosted OpenAI or Anthropic; set it to an OpenAI-compatible `/v1` URL for a local server. When those keys are empty, the CLI loads repo-root `.env` (so `pnpm --filter @icas/agent exec` still works). A non-empty shell export is not overwritten. Until wired, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ICAS_MODEL` still work as a fallback.
