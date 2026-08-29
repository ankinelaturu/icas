# @icas/policy

Prompt-policy loading plus runtime execution allowlist/guardrails.

- `loadPromptPolicy()` reads markdown from `packages/policy/prompts/`. Set `ICAS_PROMPT_POLICY` (or pass a path) to override. Missing files throw a clear error.
