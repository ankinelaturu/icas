# 05 — Replay Engine

## Responsibility

`ReplayEngine` executes a supplied capability deterministically. It is the production execution path shared by `icas-play`, `icas-mcp`, and `icas-adapt` verification.

Strict replay contains no LLM decisions.

## Core loop

For every step except the last, replay:

```text
validate preconditions (if any)
    ↓ fail → stop with structured result
execute action through PolicyGuard + Surface
    ↓ fail → this step’s target missing: not a previous-step outcome
    ↓        recover interstitial / assist / stop
resolve the *next* step’s action locator
    ↓ found → continue to that step (do not scan outcomes)
    ↓ missing → if the surface reported a document HTTP 403 / 404 / 5xx
                 for this navigation, stop as failure (5xx may retry first;
                 see recoverable waits). Do not scan phrases yet.
    ↓         → walk the *just-executed* step’s possibleOutcomes in order
                 skip kind "success"
                 an outcome hits when *any* match.phrases entry is visible (OR)
                 first hitting outcome wins:
                   error → business_outcome (heading, summary, match in details)
                   hitl  → same message + handoff on this session
    ↓ none    → walk the runtime generic phrase list (same shape, not on the artifact)
    ↓ none    → failure (or HITL only if this run already treats unknown as stuck)
```

This step’s target missing (cannot click Inquire) is a locator/script miss. It is **not** classified from this step’s `possibleOutcomes`. Those hints explain why the **following** control (e.g. Payoff) is absent after this action ran.

After the last step:

```text
verify overall success assertions
    ↓ fail → HTTP status (if known), then that last step’s possibleOutcomes,
             then the runtime generic phrase list, same as above
extract declared outputs
validate output types
return structured success
```

Per-step postconditions remain in the schema. They are not the exceptional-state catalog. Step `possibleOutcomes` plus ICAS-level HTTP/generic chrome are. Empty `preconditions` / `postconditions` are valid. The union happens in **replay**, not in the proposal or the capability schema.

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

Expected application results that the caller must know about. They are not crashes.

Replay does **not** own a product-specific message table. It walks `possibleOutcomes` on the effective capability in array order. An entry hits when **any** `match.phrases` string is visible (**OR**). The first hitting entry with `kind: "error"` returns `business_outcome`. `details` carries that entry’s `heading`, `summary`, and `match` so MCP/`icas-play` can format a response. Evidence still includes a screenshot.

`outcome` on `ExecutionResult` may be a stable slug derived from the hit (or the matching phrase). It is **not** a hardcoded loan-payoff enum inside `ReplayEngine`.

Behavior: stop normally and return `business_outcome`.

### ICAS-level HTTP and generic chrome

Step `possibleOutcomes` are goal-specific guesses. Infrastructure failures are a **runtime** catalog. Replay applies them around the step list; it does not merge them into the artifact or the discover prompt.

Walk order when the next locator is missing (or last-step `success` misses):

1. **Document HTTP status** (when the surface actually observed it): 403 / 404 → `failure`; 5xx → recoverable wait first, then `failure` if it persists. Staff UIs often return **200** with an error banner; a missing status is not a miss of this step — continue to phrases.
2. **This step’s `possibleOutcomes`** (skip `success`). First phrase hit wins.
3. **Runtime generic phrase list** — a tiny fixed set of distinctive *visible* chrome (`Internal Server Error`, `Access Denied`, `404 Not Found` as page text). Same `PossibleOutcome` shape (`kind` `error` or `hitl`). Not stored on the capability. Not a closed enum of domain results.
4. **None** → `failure`.

Specific step guesses always beat generic 500 copy. Do not put status codes or this generic list in proposer **instructions**. Do not add HTTP fields to `CapabilityStep`.

Many legacy screens never expose a document status (XHR, frames, `200` error pages). Phrase matching remains the main classifier for application copy.

### Matching `match.phrases`

The first implementation uses exact/substring visible-text search (same family as `textVisible`). A single generic token is too weak; phrases should be distinctive multi-word copy.

A later matcher may embed the page text and the stored phrases and compare them (local embeddings, bounded latency). That does **not** change the artifact: do not store vectors on the capability. Strict replay still has **no LLM**. Thresholds and false-positive policy belong to that later pass, not to discover.

Do not search `heading` or `summary` on the page.

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
- document HTTP 403 / 404 / persistent 5xx when the surface reported them (Pass 4.16)

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

`--assist` reads **`ICAS_ASSIST_LLM_*`** (independent of discovery). Same shape: `MODEL` (`provider/model`), `API_KEY`, optional `BASE_URL` (`/v1` for OpenAI-compatible local servers; empty means the provider's public host), and optional sampling (`TEMPERATURE`, `TOP_K`, `TOP_P`, `MAX_OUTPUT_TOKENS`). Ready when `MODEL` is set and either `API_KEY` or `BASE_URL` is set. Strict replay without `--assist` ignores this env entirely.

Env is model transport. The SDK seam is `RepairProposer` (injected in `icas-play`; `@icas/replay` stays model-free). Until the code pass lands, `--assist` still accepts `ICAS_MODEL` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as a fallback.

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

This avoids tenant-specific branching inside replay. Goal-specific exceptional copy lives on the artifact (`possibleOutcomes`). HTTP status and generic error chrome live in the engine. Normal policy, HITL, error, and evidence handling remain unchanged.

Registry CRUD, on-disk layout, tenant enrollment, and `FileSystemCapabilityRegistry({ root })` are specified in [`04-capability-artifact.md`](04-capability-artifact.md). Replay depends on the `CapabilityRegistry` interface and the resolved effective artifact only. `icas-play` / `icas-mcp` resolve with a tenant (CLI default `icas-bank`) and require that tenant to already be enrolled.

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

- a `possibleOutcomes` hit has `kind: "hitl"` (message plus the same session);
- a risky encoded action requires approval;
- an unexpected state cannot be recovered (no step or generic `match.phrases` hit);
- policy requires human control;
- assisted fallback is disabled/exhausted.

If `kind: "hitl"` fires but no `HandoffController` is available, fail closed with the heading/summary in the result. Do not hang.

`kind: "error"` must not pause for a human. The application already answered.

The same browser session remains alive during handoff.

## Evidence

`ReplayEngine` owns the run log when an `EvidenceWriter` is injected. Every terminal status appends checkpoints to `log.jsonl` and writes `summary.json`. Successful replay is log-only. Failures, HITL, and business-outcome stops also capture a screenshot and DOM snapshot. Assisted repair uses event type `assisted_fallback`, never `action`. See [`09-evidence-observability.md`](09-evidence-observability.md).
