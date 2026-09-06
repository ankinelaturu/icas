# icas-adapt

Cross-tenant capability adaptation CLI using guarded replay plus a one-step `StepSpecializer`.

```text
pnpm icas-adapt loan-payoff --tenant loki-bank --url <url> --loanAccountId … --payoffDate …
```

`--tenant` is required (never defaulted). `--url` only opens the surface.

Compatible guarded replay writes a header-only override (`createdBy: "verified"`) and does not call a model.

A one-step mismatch captures visible page text, calls Mastra once (`ICAS_ADAPT_LLM_*`: `MODEL`, `API_KEY`, optional `BASE_URL`, sampling), writes `createdBy: "icas-adapt"`, then re-verifies with `ReplayEngine` (no LLM). A failed re-verify rolls the override back. Large drift aborts; rediscover instead.

Stdout prints every stage plus the LLM round-trip: system instructions, the exact user prompt passed to `generate`, the structured model object (pretty JSON, not the Mastra envelope), token usage, and the mapped `StepOverride`. API keys are never printed.

When those keys are empty, the CLI loads repo-root `.env` the same way `icas-agent` does. `--assist` (`ICAS_ASSIST_LLM_*`) is a different flow and does not persist an override.

Enrollment is kept only after `CapabilityResolver` + `ReplayEngine` re-verify the effective capability. The final summary is `status: enrolled` plus the re-verify run. A failed re-verify prints the second-run stop on stderr and rolls the override back.
