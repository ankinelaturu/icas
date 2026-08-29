# @icas/policy

Prompt-policy loading plus runtime execution allowlist/guardrails.

- `PolicyGuard` requires a human for `risk: "risky"` and **denies** transfer/payment/delete-like control text even if the model tagged the action `safe`.
