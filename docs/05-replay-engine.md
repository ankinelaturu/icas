# 05 — Replay Engine

## Responsibility

`ReplayEngine` executes a supplied capability deterministically. It is the production execution path shared by `icas-play`, `icas-mcp`, and `icas-adapt` verification.

Strict replay contains no LLM decisions.

## Core loop

For every step:

```text
validate preconditions
    ↓ fail → stop with structured result
execute action through PolicyGuard + Surface
    ↓ fail → classify/recover/stop
validate postconditions
    ↓ fail → classify/recover/stop
continue
```

After all steps:

```text
verify overall success
extract declared outputs
validate output types
return structured success
```

## Structured result contract

```ts
type ExecutionResult =
  | {
      status: "success";
      capabilityId: string;
      outputs: Record<string, unknown>;
      runId: string;
    }
  | {
      status: "business_outcome";
      capabilityId: string;
      outcome: string;
      details?: unknown;
      runId: string;
    }
  | {
      status: "failure";
      capabilityId: string;
      code: string;
      stepId?: string;
      expected?: unknown;
      observed?: unknown;
      runId: string;
    };
```

## Error/outcome taxonomy

### Business outcomes

Expected domain results that the caller must know about. They are not crashes.

Examples:

- `LOAN_NOT_FOUND`
- `PAYOFF_NOT_AVAILABLE`
- `INVALID_PAYOFF_DATE`
- `LOAN_ALREADY_PAID`

Behavior: stop normally and return `business_outcome`.

### Recoverable runtime conditions

Transient or known environmental conditions that may be handled without changing the capability intent.

Examples:

- transient slow load;
- known session-warning/interstitial;
- temporary application error;
- retryable network/navigation timeout.

Behavior: bounded wait/retry or known recovery, then continue. Recovery is logged.

### Hard failures / mismatches

The system cannot safely continue deterministically.

Examples:

- `PRECONDITION_FAILED`
- `TARGET_NOT_FOUND`
- `POSTCONDITION_FAILED`
- `POLICY_BLOCKED`
- `UNEXPECTED_STATE`
- `OUTPUT_EXTRACTION_FAILED`

Behavior: stop, capture rich evidence, and return a debuggable failure unless explicit HITL or assisted fallback is enabled.

## Wait and retry semantics

Never rely on arbitrary fixed sleeps as the primary synchronization mechanism. Assertions/actions should support bounded timing metadata, e.g.:

```ts
{
  timeoutMs: 10_000,
  pollingMs: 250
}
```

Potential retry policy:

```ts
{
  maxAttempts: 2,
  on: ["transient_load", "known_interstitial"]
}
```

Retries must not turn semantic mismatches into indefinite waiting.

## Strict vs assisted replay

Default:

```text
icas-play run ...
→ deterministic, no LLM
```

Optional stretch mode:

```text
icas-play run ... --assist
```

If one step fails:

1. freeze the current failure context;
2. invoke a bounded LLM repair for that step only;
3. apply runtime policy to the proposed repair;
4. execute the replacement action(s) within a strict budget;
5. verify the failed step's intended postconditions;
6. verify the next original step's preconditions;
7. only then rejoin the deterministic path;
8. record the recovery as evidence.

If the repaired state does not rejoin the known path, stop. Assisted fallback is not open-ended rediscovery.

## Effective capability resolution

`ReplayEngine` remains tenant-agnostic. A `CapabilityResolver` loads the base capability and applicable tenant override, applies the declarative patch, and schema-validates the resulting effective capability. Only then is the effective capability passed to `ReplayEngine`.

```text
CapabilityRegistry
      ↓
base capability + tenant override
      ↓
CapabilityResolver
      ↓
schema validation
      ↓
effective capability
      ↓
ReplayEngine
```

This avoids tenant-specific branching inside replay. Normal precondition/action/postcondition, policy, HITL, error, and evidence handling remain unchanged.

## Guarded compatibility mode

`icas-adapt` can invoke the same replay engine against another tenant using the same Vendor+Product. The checkpoints determine whether the capability is compatible:

```text
same Vendor+Product
→ candidate capability
→ guarded replay
→ all checkpoints pass: compatible
→ mismatch: specialize / rediscover affected region
```

The replay engine therefore becomes the authority on whether an artifact actually works in the observed runtime state.

When `icas-adapt` sees a mismatch, it may generate an override. The override is not considered valid merely because it was generated. Resolve base + override, then run the effective capability through `ReplayEngine` again. All normal checkpoints must pass before the tenant specialization is considered verified.

## HITL

Replay can emit an intervention request when:

- a risky encoded action requires approval;
- an unexpected state cannot be recovered;
- policy requires human control;
- assisted fallback is disabled/exhausted.

The same browser session remains alive during handoff.
