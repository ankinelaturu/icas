# 08 — Safety Policy

## Goal

Neither an LLM nor a recorded capability should have unrestricted authority over a banking application.

Safety is split into three independent concerns:

1. prompt policy — influence what the model proposes;
2. runtime policy — enforce what the system will execute;
3. redaction — control what data may leave runtime memory or be persisted.

## Injectable prompt policy

Prompt safety text lives as data under:

```text
packages/policy/prompts/*.md
```

The agent loads and injects this text into Mastra/model instructions. This allows app/tenant-specific policy without recompiling runtime code.

The default policy permits navigation, search, reading, and non-sensitive field entry required by the goal while prohibiting actions such as fund transfer, payments, loan-term modification, account closure, record deletion, or intentional off-target navigation.

If an action appears risky or ambiguous, the model should request human intervention.

## Runtime policy

Prompt instructions are not enforcement. Every proposed or recorded action passes through a runtime guard before execution.

```text
LLM / capability
      ↓
proposed action
      ↓
PolicyGuard
  ├── allow
  ├── deny
  └── require human
      ↓
Surface
```

Initial runtime policy:

```ts
interface RuntimePolicy {
  allowedOrigins: string[];
  allowedActionTypes: ActionType[];
  approvalRequiredForRisk?: ["risky"];
}
```

## Navigation safety

Two checks are useful:

1. before execution, resolve a known destination (e.g. anchor href) when possible and validate its origin/route;
2. guard resulting browser navigation/request boundaries because not all clicks reveal their destination before execution.

The model can propose anything. The executor decides what is actually permitted.

## Risky actions

Model output/action metadata may classify intent/risk, but the runtime should not trust model self-classification as the only signal. Obvious dangerous control text/semantic intent can be independently rejected or escalated where possible.

Initial decisions:

```ts
type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "require-human"; reason: string };
```

## Policy during replay

Saved artifacts do not bypass safety. Strict replay and assisted fallback both route through PolicyGuard.

## Redaction boundary

Redaction is implemented in `packages/redactor`, not embedded in PolicyGuard. This makes it independently configurable for different boundaries:

- model observation payload;
- evidence/log persistence;
- error messages;
- future network APIs.

Synthetic tenant data means the demo contains no real PII, but the architecture must avoid normalizing unsafe persistence patterns.
