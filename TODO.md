# ICAS Implementation TODO

Living checklist for filling in the scaffold. Design source of truth is `docs/`. Update the relevant design note in the same change if an architectural decision shifts.

**Commit rule:** one pass = one commit. Do not combine passes. Each pass should be reviewable on its own and leave the repo building/typechecking.

**Agreed constraints**

- Implementation order: capability → surface/browser → replay → discovery/compiler, then apps.
- Add fixtures and tests in the same pass that introduces the behavior.
- Full tenant apps: icas-bank, loki-bank, and helix-cu are in (Phase 7).
- LLM env is Phase 5 (`ICAS_*_LLM_*`). Screenshot pixels on `generate` are Pass 5.22.
- Assisted fallback, `icas-adapt`, HITL browser takeover, and MCP are in scope.
- Tenant specialization is a declarative `CapabilityOverride` resolved by `CapabilityResolver`. `ReplayEngine` stays tenant-agnostic.
- Every discovered or verified tenant gets an override file (empty patch allowed). `icas-play` / MCP require enrollment.
- CLI: `--id` is the unique catalog name. `--vendor` / `--product` / `--tenant` default to `icas-bank`. Do not infer them from `--url`.

**Out of scope**

- Production co-browsing / operator console
- Distributed queues/workers
- Real bank credentials or PII
- Desktop/accessibility surface (keep the `Surface` seam; do not implement a second driver)
- REST/DB capability registries (keep the `CapabilityRegistry` interface; only `FileSystemCapabilityRegistry` is implemented)

---

## Phase 1 — Capability contract

`packages/capability`

### Pass 1.1 — Override types

- [x] Add `CapabilityOverride`, `StepOverride`, override operations (`steps`, `insertBefore`, `insertAfter`, `disabledSteps`), and provenance types (`createdBy`: `discovery` | `verified` | `icas-adapt` | `human`)
- [x] Export from `@icas/capability`

### Pass 1.2 — Base capability schema validation

- [x] Validate required fields, `schemaVersion`, inputs/outputs, step shape, action vocabulary, assertion families
- [x] Clear errors for invalid artifacts
- [x] `schemaVersion` is the JSON format (`"1.0"`)
- [x] Tests: valid `tests/fixtures/loan-payoff.capability.json` passes; truncated/unknown-action fixtures fail
- [x] Add package Vitest config in this pass (first tests in the package)

### Pass 1.3 — Input/output type helpers

- [x] Validate values against `string` | `number` | `boolean` | `date` | `money`
- [x] Resolve `ValueRef` (`input` vs `literal`) given an input map
- [x] Tests for each primitive and for missing/invalid refs

### Pass 1.4 — Override schema validation

- [x] Validate override shape, `baseCapability` catalog id, tenant target, provenance
- [x] Reject executable / `customJavaScript`-style patches
- [x] Tests: valid override fixture; JS-patch rejection; missing base id

### Pass 1.5 — Filesystem capability registry

- [x] Implement `CapabilityRegistry` plus `FileSystemCapabilityRegistry({ root })` as specified in `docs/04-capability-artifact.md`
- [x] `list` (optional vendor/product filter), `get(id)`, `save` (upsert + validate), `remove`
- [x] On-disk layout: `capabilities/<id>/capability.json`
- [x] Do not bake tenant identity into the base artifact
- [x] Tests against a temp directory (not the real `capabilities/` submission dir)

### Pass 1.6 — Override storage and registry

- [x] On-disk layout: `capabilities/<id>/overrides/<tenant>.json` pinned to the catalog id
- [x] Empty `overrides: {}` is valid (header-only enrollment)
- [x] `listOverrides` / `getOverride` / `saveOverride` / `removeOverride`
- [x] `saveOverride` rejects if that catalog id is not stored
- [x] Tests for round-trip save/load and header-only override

### Pass 1.7 — Resolver: whole-step replace

- [x] `CapabilityResolver`: load base + tenant override
- [x] Refuse when `baseCapability` is not the stored catalog id
- [x] Apply whole-step replace
- [x] Schema-validate the effective capability before returning it
- [x] Tests: happy replace; unknown base id; invalid resolved artifact rejected

### Pass 1.8 — Resolver: partial step patches

- [x] Replace target/locator only
- [x] Replace preconditions only
- [x] Replace postconditions only
- [x] Tests for each partial patch, including unchanged fields preserved

### Pass 1.9 — Resolver: insert / disable

- [x] `insertBefore` / `insertAfter` a known step id
- [x] `disabledSteps`
- [x] Error when the referenced step id does not exist
- [x] Tests: insert, disable, unknown step id

### Pass 1.10 — Step `possibleOutcomes` schema

Exceptional-state catalog on the artifact; see `docs/04-capability-artifact.md`.

- [x] `PossibleOutcome` / `OutcomeMatch` on capability steps (`kind`: `success` | `error` | `hitl`; `match.phrases`; `heading` / `summary` nullable)
- [x] Optional array; empty is valid; 1–3 phrases per outcome
- [x] `heading` is tool/HITL copy only, never a locator
- [x] `StepOverride` may replace `possibleOutcomes`
- [x] Tests: valid fixture with outcomes; unknown kind / empty phrases fail; resolver replace

### Pass 1.11 — One base per id

Catalog identity is `id` only.

- [x] One `capability.json` per catalog id
- [x] Override `baseCapability` is the catalog id
- [x] Discover refuses an existing id
- [x] `icas-play` / `icas-adapt` select by id (no flow-version flag)
- [x] Document future second-base / version pin if a base edit must not leak to every tenant

---

## Phase 2 — Surface and browser

`packages/surface`, `packages/browser`

### Pass 2.1 — HTML fixtures

- [x] Static pages under `tests/fixtures/` for home / lending / loan-search / labeled fields
- [x] Enough markup to exercise role+text, label, and visible-text strategies

### Pass 2.2 — Browser lifecycle

- [x] `PlaywrightSurface.open(url)` launches headed browser and navigates
- [x] Close/teardown is explicit and safe to call twice
- [x] Test: open fixture page, read URL, close

### Pass 2.3 — Target resolution (semantic)

- [x] Ranked strategies: `roleText`, `visibleText`, `label`
- [x] Try strategies in order; fail with a clear `TARGET_NOT_FOUND`-style error
- [x] Tests against Pass 2.1 fixtures

### Pass 2.4 — Target resolution (fallbacks)

- [x] `relative`, `css`, `xpath`
- [x] Coordinates last resort only; do not treat them as a robust production locator
- [x] Tests for fallback order and missing target

### Pass 2.5 — Execute actions

- [x] `click`, `fill`, `select`, `navigate` (relative path), `read`
- [x] Map semantic `CapabilityAction` → Playwright; no capability schema change
- [x] Tests: fill a labeled field, click, read back the value

### Pass 2.6 — Assertions with bounded waits

- [x] Implement assertion families: `textVisible`, `controlPresent`, `valueEquals`, `urlMatches`, `state`
- [x] Bounded `timeoutMs` / polling; no fixed sleep as the primary wait
- [x] Tests: pass, timeout-fail, value mismatch

### Pass 2.7 — Observation capture

- [x] Screenshot to a path; optional accessibility/DOM supplement
- [x] Do not require clean test IDs
- [x] Test: observe fixture page produces an image file + metadata

### Pass 2.8 — Navigation / origin hooks

- [x] Expose known destination (e.g. anchor href) before click when possible
- [x] Report resulting URL after navigation
- [x] Test: in-origin vs off-origin link on a fixture page

### Pass 2.9 — Browser handoff seam

- [x] `handoffToHuman`: stop issuing automation actions; keep the same session alive
- [x] Resume returns control to automation
- [x] Test: execute is rejected while human owns the session; allowed after resume

### Pass 2.10 — Document HTTP status on observation

Replay Pass 4.16 needs this. Do not classify business outcomes here.

- [x] When Playwright observed a document response status, put it on `Observation` (optional field; missing is valid)
- [x] XHR, frames, and `200` error banners may omit status — that is not a miss of this pass
- [x] Tests: a fixture 404 reports `404`; a normal page may omit status or report `200`

### Pass 2.11 — Relative locates associated value

Default `relative` was `following::input[1]`, then a `td` allowlist. That encoded ICAS Bank tables in the engine. Helix confirmation rows are caption + sibling value (`span` / `div`), often with the same string on an `<h1>`.

- [x] Default `relative` (no `xpath` / `role`) locates the caption's following sibling (wrapped form control if present, else the sibling). Headings are not captions. No sibling → next form control
- [x] Explicit `xpath` / `role` on the strategy still win
- [x] Tests: unlabeled input after a caption still fills; caption `td` + value `td` wrapping an input fills the input; caption|value table row `read` returns the cell text, not the caption; heading+sibling value `read` returns the value, not the heading or lead line

---

## Phase 3 — Policy, redaction, evidence, handoff

Cross-cutting runtime used by replay and discovery.

### Pass 3.1 — Prompt policy loader

- [x] Load markdown from `packages/policy/prompts/*.md`
- [x] Honor `ICAS_PROMPT_POLICY`
- [x] Test: default file loads; missing path errors clearly

### Pass 3.2 — PolicyGuard action allowlist

- [x] Allow / deny by `allowedActionTypes`
- [x] Tests: allowed click/fill; denied unknown or disallowed type

### Pass 3.3 — PolicyGuard origin checks

- [x] Deny off-origin destination when known before execute
- [x] Deny resulting navigation that leaves `allowedOrigins`
- [x] Tests: in-origin allow; off-origin deny

### Pass 3.4 — Risky action escalation

- [x] `require-human` for `risk: "risky"`
- [x] Independent check of dangerous control text/intent (do not trust model self-classification alone)
- [x] Tests: risky → human; transfer/payment-like text → deny or human

### Pass 3.5 — Redactor profiles

- [x] Profiles for model payload, evidence persistence, terminal/error output
- [x] Pattern/value masking; unconfigured content preserved
- [x] Tests: independent profiles; no cross-profile leakage

### Pass 3.6 — Evidence writer core

- [x] Run-scoped dirs: `evidence/<capability>/<run-id>/`
- [x] Append-only JSONL + `summary.json`
- [x] Tests: append two events, read them back, summary written

### Pass 3.7 — Evidence rich signals + redaction

- [x] Observations directory for discovery screenshots
- [x] Rich failure signal (screenshot/DOM) on failure and HITL
- [x] Persist only after `Redactor`
- [x] Tests: redacted payload on disk; screenshot path recorded

### Pass 3.8 — Evidence run typing

- [x] Tag `discovery` | `replay` | `adaptation`
- [x] Tag actor `agent` | `replay` | `human`
- [x] Distinct event type for assisted-fallback vs deterministic replay
- [x] Tests for tags on sample events

### Pass 3.9 — Handoff ownership

- [x] Implement `HandoffController` with `ControlOwner`
- [x] `request` sets owner to `human`; `waitForResume` returns to `automation`
- [x] Tests: transition, no automation action while human owns control, required `InterventionRequest` fields

### Pass 3.10 — CLI approval / input

- [x] Prompt for approval or a required value over stdin
- [x] Record the answer as evidence (`actor: human`)
- [x] Test with a stubbed stdin

### Pass 3.11 — Browser takeover recording

- [x] Pause automation, keep headed session, wait for ENTER
- [x] Record handoff start/end and observable state before/after
- [x] Test: ownership + evidence events (browser interaction can be stubbed)

---

## Phase 4 — Replay engine

`packages/replay`

Callers resolve with `CapabilityResolver` first. `ReplayEngine` never branches on tenant.

### Pass 4.1 — Engine skeleton

- [x] `run(effectiveCapability, inputs, options)` iterates steps
- [x] Return structured `ExecutionResult` (`success` | `business_outcome` | `failure`) with `runId`
- [x] Stub step execution; tests for empty-steps success and missing-capability failure shape

### Pass 4.2 — Preconditions

- [x] Evaluate each step’s preconditions via `Surface.assert`
- [x] Fail with `PRECONDITION_FAILED`, `stepId`, expected vs observed
- [x] Tests: pass-through vs first-step mismatch

### Pass 4.3 — Policy gate before execute

- [x] Every action goes through `PolicyGuard`
- [x] `POLICY_BLOCKED` on deny
- [x] Tests: allowed action executes; denied action never hits `Surface.execute`

### Pass 4.4 — Execute + postconditions

- [x] Execute through `Surface`
- [x] Evaluate postconditions
- [x] Fail with `POSTCONDITION_FAILED` or `TARGET_NOT_FOUND`
- [x] Tests: action+postcondition happy path; postcondition mismatch

### Pass 4.5 — Success condition + output extraction

- [x] Overall `success` assertions after all steps
- [x] Extract declared outputs; validate types via Pass 1.3 helpers
- [x] `OUTPUT_EXTRACTION_FAILED` when missing/invalid
- [x] Tests: typed outputs; extraction failure

### Pass 4.6 — Business outcomes

- [x] Domain results such as `LOAN_NOT_FOUND`, `PAYOFF_NOT_AVAILABLE`, `INVALID_PAYOFF_DATE`, `LOAN_ALREADY_PAID`
- [x] Return `business_outcome`, not a Playwright exception
- [x] Tests: fixture that presents “loan not found” maps to `LOAN_NOT_FOUND`

### Pass 4.7 — Recoverable waits / retries

- [x] Bounded retry for transient load, known interstitial, retryable timeout
- [x] Log recovery in evidence
- [x] Do not retry semantic mismatches
- [x] Tests: interstitial then success; semantic fail does not retry forever

### Pass 4.8 — Hard failures + evidence

- [x] Codes: `PRECONDITION_FAILED`, `TARGET_NOT_FOUND`, `POSTCONDITION_FAILED`, `POLICY_BLOCKED`, `UNEXPECTED_STATE`, `OUTPUT_EXTRACTION_FAILED`
- [x] Capture rich evidence at the failure boundary
- [x] Tests: each code at least once with `stepId` / expected / observed

### Pass 4.9 — Replay HITL

- [x] Emit intervention when policy requires human, state is unrecoverable, or assist is disabled/exhausted
- [x] Same browser session stays alive
- [x] Tests: risky encoded action pauses; resume continues from the same step contract

### Pass 4.10 — Assisted fallback (repair)

- [x] `--assist` / `options.assist`: on one failed step, freeze context and ask model for a bounded repair
- [x] Run proposed actions through `PolicyGuard` and a strict budget
- [x] Record as assisted-fallback evidence, not deterministic actions
- [x] Tests: policy-blocked repair is not executed; budget exceeded stops

### Pass 4.11 — Assisted fallback (rejoin)

- [x] After repair, verify the failed step’s postconditions and the next original step’s preconditions
- [x] Rejoin deterministic path only if both pass; otherwise stop
- [x] Tests: successful rejoin; failed rejoin does not continue inventing steps

Pass 4.17 assists the missing next click on a next-locator miss (not the fill).

### Pass 4.12 — Replay integration tests

- [x] `tests/integration/capability-replay.test.ts`
- [x] `tests/integration/loan-not-found.test.ts`
- [x] `tests/integration/assisted-fallback.test.ts`
- [x] Against HTML fixtures, not full tenants

### Pass 4.13 — Full-run replay evidence

- [x] Append checkpoint JSONL for every step on all terminal statuses (`success`, `business_outcome`, `failure`)
- [x] Engine writes `summary.json` for every run (play / adapt / MCP no longer duplicate it)
- [x] HITL records start, before/after observation, resume, and end (`actor: human`)
- [x] Rich signal (screenshot/DOM) on failure, HITL, and business-outcome stops — not on success
- [x] Tests: success log without screenshots; business_outcome log; HITL human events; failure still captures screenshot

### Pass 4.14 — Classify from `possibleOutcomes`

Depends on Pass 1.10. Replaces Pass 4.6’s hardcoded product table (`LOAN_NOT_FOUND`, …). See `docs/05-replay-engine.md`.

- [x] After execute (not last step): resolve the **next** step’s action locator first; if found, continue (do not scan outcomes)
- [x] If that locator is missing, walk the **just-executed** step’s `possibleOutcomes` in order; skip `kind: "success"`; an outcome hits when any `match.phrases` entry is visible (OR); first hit wins
- [x] `error` → `business_outcome` with that entry’s `heading`, `summary`, and `match` in details — not an engine loan-message enum
- [x] `hitl` → intervention message + same-session handoff
- [x] None hit → `failure`
- [x] Last step: overall `success` assertions miss, then scan that last step’s list the same way
- [x] This step’s own target miss is locator/script failure, not this step’s `possibleOutcomes`
- [x] Remove `ReplayEngine` product copy table (`packages/replay/src/business-outcomes.ts` or equivalent)
- [x] Tests: next locator missing + phrase visible → `business_outcome`; `hitl` kind pauses; no match → `failure`; engine has no loan-copy strings

### Pass 4.15 — Phrase embeddings (deferred)

Same artifact field. Do not store vectors on the capability. Strict replay still has no LLM.

- [x] `EmbeddingOutcomeMatcher` is registered after substring and currently always misses (stub)
- [ ] Matcher may embed page text vs stored `match.phrases` (local, bounded latency)
- [ ] Threshold / false-positive policy lives here, not in discover
- [ ] Tests against the same fixtures as Pass 4.14

### Pass 4.16 — HTTP status and generic chrome fallback

Depends on Pass 4.14 and Pass 2.10. Do not put this catalog on the capability or in discover instructions. See `docs/05-replay-engine.md`.

- [x] When the next locator misses: if the surface reported document HTTP 403 / 404, stop as `failure` before scanning phrases; 5xx uses existing recoverable wait then `failure`
- [x] After step `possibleOutcomes` miss, walk a tiny runtime list of distinctive visible chrome (same `PossibleOutcome` shape; not stored on the artifact)
- [x] Step-specific phrases win over generic 500 / access-denied copy
- [x] Missing HTTP status is normal (200 error banners, XHR); continue to phrases
- [x] Tests: document 404 fails without needing artifact phrases; generic visible “Internal Server Error” hits fallback; compiled step phrase wins when both could match

### Pass 4.17 — Assist next-locator miss (rejoin the missing click)

Depends on Pass 4.10 / 4.11. No catalog writes. See `docs/05-replay-engine.md`.

After a successful fill, replay probes the **next** locator. Unclassified miss is `UNEXPECTED_STATE` with `stepId` of that next click (`click-inquire`). Assist freezes that click, sends clipped `visibleText()` (submit values included) to the repair model, rejoins that click’s postconditions, and skips executing Inquire again.

- [x] On `NEXT_ACTION_TARGET_MISSING` / next-locator `UNEXPECTED_STATE`, assist the **missing next step**, not the fill that already succeeded
- [x] After repair actions, rejoin that click’s postconditions (and the following step’s preconditions)
- [x] Still one assist per run; `PolicyGuard` + budget unchanged; do not persist an override
- [x] Repair prompt includes visible page chrome so the model can see synonyms (Look Up), not only the missing Inquire locator
- [x] Tests: fill ok + next submit renamed → `--assist` clicks the synonym and rejoins; catalog untouched

---

## Phase 5 — Discovery and compiler

`packages/discovery` (Mastra `@mastra/core@1.63.0`)

ICAS owns search state, budget, trace, and compiler. Mastra is the LLM/tool layer only.

### Pass 5.1 — Candidate action schema

- [x] `CandidateAction` type: action, rationale, rank, optional expectation/risk
- [x] Schema-validate model output; reject free-form prose
- [x] Tests: valid candidate; malformed payload rejected

### Pass 5.2 — Search state and budgets

- [x] `SearchNode` (state id, observation, candidates, tried ids, parent)
- [x] Limits: max steps, max depth, max candidates per state, timeout
- [x] Tests: budget fields parse as numbers

### Pass 5.3 — Discovery loop skeleton (no live model)

- [x] `DiscoveryAgent.run` always discovers (never silent replay)
- [x] Loop: observe → (stub) candidates → policy → execute → record → stop on budget
- [x] Tests with a fake proposer: one successful click path; timeout stop

### Pass 5.4 — Mastra tool/LLM adapter

- [x] Wire Mastra for structured candidate generation
- [x] Pin extra `@mastra/*` packages only if needed, to concrete versions (not `latest`)
- [x] Keep search controller in ICAS, not in Mastra memory
- [x] Test: adapter returns schema-validated candidates from a mocked model

### Pass 5.5 — Model / vision provider

- [x] Choose and document default provider/model (vision-capable default; pixels are Pass 5.22)
- [x] Env: `ICAS_DISCOVERY_LLM_*` / `ICAS_ASSIST_LLM_*`
- [x] Inject prompt policy from Pass 3.1
- [x] Smoke test behind a flag or recorded fixture if CI has no keys

### Pass 5.6 — Ranked bounded search

- [x] Try highest-ranked untried candidate first
- [x] Enforce max steps/depth/candidates
- [x] Tests: rank order; depth limit stops expansion

### Pass 5.7 — Repeated state and backtrack accounting

- [x] Detect repeated states
- [x] Track tried candidates; backtrack to next sibling
- [x] Tests: dead-end then sibling tried; repeated state does not loop

### Pass 5.8 — Backtrack restore

- [x] Do not assume `page.goBack()` restores SPA/modal/POST state
- [x] Restore via history when reliable, else replay known prefix from entry URL
- [x] Test on a fixture where history-back is insufficient

### Pass 5.9 — Discovery HITL

- [x] Request intervention when stuck, ambiguous, risky, or policy-blocked
- [x] Resume into the same search node
- [x] Tests: policy-block → intervention; resume continues

### Pass 5.10 — Discovery trace

- [x] Append-only JSONL: observation, ranked candidates, chosen action, policy, result, dead-end, backtrack, intervention, success
- [x] Screenshots referenced from the trace
- [x] Test: fixture run produces expected event types in order

### Pass 5.11 — Compiler: successful path only

- [x] Read a fixture trace; drop failed branches from the executable artifact
- [x] Failed branches remain evidence-only
- [x] Test: trace with a dead-end then success compiles only the success steps

### Pass 5.12 — Compiler: parameterize inputs

- [x] Replace concrete discovery values with `ValueRef` input references

### Pass 5.13 — Compiler: targets, checkpoints, outputs

- [x] Derive semantic targets, pre/post, output extraction, overall success
- [x] Attach `schemaVersion` and Vendor+Product identity
- [x] Write via `CapabilityRegistry`
- [x] Test: compiled artifact passes Pass 1.2 validation

### Pass 5.14 — Compiler: human actions

- [x] Recurring approval → explicit `handoff` step
- [x] Exceptional manual recovery stays evidence, not happy-path
- [x] Tests for both classifications

### Pass 5.15 — Discovery integration test

- [x] `tests/integration/discovery-to-capability.test.ts`
- [x] Fake or recorded model + HTML fixtures → validated capability file

### Pass 5.16 — Docs: `proposedInputParam` compile

Proposer names params; compiler aggregates; no CLI literal reverse-lookup.

- [x] `docs/03` compile step 4 and candidate `proposedInputParam`; instructions stay goal-agnostic (no product field-name list)
- [x] `docs/01` / `docs/04` / agent README: discover is `--id` `--url` `--goal`; replay still takes typed params

### Pass 5.17 — LLM `proposedInputParam` schema

Depends on Pass 5.16.

- [x] Flat LLM action schema: nullable `{ name, type, required }` on every action
- [x] Mapper copies the hint onto `CandidateAction`, not catalog `CapabilityAction`
- [x] Fill/select without a hint fail mapping; click/navigate/read/handoff must be null
- [x] `chosen_action` + `extractSuccessfulPath` keep the hint
- [x] Tests: LLM schema parse; fill without hint rejected

### Pass 5.18 — Compiler: aggregate `proposedInputParam`

Depends on Pass 5.17.

- [x] Compiler aggregates unique names into artifact `inputs` and rewrites fills/selects to `{ input: name }`
- [x] Fail closed: fill/select without hint; name / type / `required` clash; same literal bound to two names
- [x] Remove `CompileRequest.inputValues`, `inputNameForLiteral`, and discover CLI leftover `--loanAccountId` / `--input` compile wiring
- [x] Prompt: fill/select always set camelCase name + type + required; same goal value → same name; no product field-name examples
- [x] Tests: compile without a CLI value map; clash fails; integration fake fill carries a hint

### Pass 5.19 — Compiler: copy `possibleOutcomes`

Depends on Pass 1.10. Prompt already described the field; this pass wires structured output and compile.

- [x] Flat LLM candidate schema includes `possibleOutcomes`; mapper copies onto `CandidateAction`
- [x] `chosen_action` + `extractSuccessfulPath` keep the list
- [x] Compile copies `error` and `hitl` only (same order) onto the step; drop `kind: "success"`
- [x] Empty list is valid; do not invent outcomes from failed DFS branches
- [x] Tests: compile copies error/hitl; success entries stripped; missing field → empty array

### Pass 5.20 — Docs: separate discovery / assist LLM env

Operator surface is already in `.env.example` (`ICAS_DISCOVERY_LLM_*` / `ICAS_ASSIST_LLM_*`). This pass is docs only.

- [x] `docs/03`: discover reads `ICAS_DISCOVERY_LLM_*`; provider is the `MODEL` prefix; empty `BASE_URL` means the provider's public host
- [x] `docs/05` (assist): `--assist` reads `ICAS_ASSIST_LLM_*`; strict replay stays model-free
- [x] Agent / play READMEs: load-repo-env still applies; operator-facing names are the `*_LLM_*` vars (no Mastra in those READMEs)
- [x] Keep `CandidateProposer` / `RepairProposer` as the SDK seam; env is model transport, not a second proposer interface
- [x] Note hosted vs local: `provider/model` + optional `BASE_URL` (`/v1` for OpenAI-compatible servers)

### Pass 5.21 — Code: wire `ICAS_DISCOVERY_LLM_*` / `ICAS_ASSIST_LLM_*`

Depends on Pass 5.20.

- [x] One settings object per flow: `MODEL`, `API_KEY`, `BASE_URL`, `TEMPERATURE`, `TOP_K`, `TOP_P`, `MAX_OUTPUT_TOKENS`
- [x] Discover uses discovery settings; `--assist` uses assist settings. Do not share one inferred model
- [x] Ready check: `MODEL` set and (`API_KEY` or `BASE_URL`)
- [x] Pass key / base URL / sampling into the existing proposer adapters (not only a `provider/model` string)
- [x] Tests: resolve discovery vs assist independently; empty BASE_URL; local BASE_URL without a cloud key; fail closed when neither key nor BASE_URL is set

### Pass 5.22 — Attach observation image to generate

Today `generate` is one string; `imagePath` is a filesystem path in that text, not pixels. Evidence still stores the PNG either way.

- [ ] Discover `generate` sends the screenshot as image content when `observation.imagePath` is set
- [ ] Keep a vision-capable default (`openai/gpt-4o`); a text-only local model must still work if the operator sets one
- [ ] Same pass: `--assist` either attaches the image or documents that repair stays path-only
- [ ] Tests: request includes image parts when a path exists; ARIA snapshot remains in the user text

### Pass 5.23 — Proposal `result` schema

Discover must not invent `read` steps to harvest values. On `status: "success"` the model returns a `result` contract (prompt already describes it). Structured output and catalog validation must accept that object.

- [x] Flat LLM proposal schema includes nullable `result` (`successSignals`, `outputs[].source` as `LlmTargetDescriptorSchema`). No `oneOf`
- [x] Mapper copies onto `CandidateProposal.result`. `success` requires non-null `result` with ≥1 `textVisible` | `urlMatches` signal. `continue` / `stuck` require `result: null`
- [x] Output `source` maps through the same target mapper as `read` (relative fallback for captions)
- [x] Tests: success maps signals + extract targets; continue with a result fails; success without result fails

### Pass 5.24 — Trace + compiler consume `result`

Depends on Pass 5.23.

- [x] `DiscoveryAgent` records `result` on the `success` trace event
- [x] Compiler prefers that payload: `artifact.success` from `successSignals`, `artifact.outputs` from declared extract targets
- [x] Missing `result` on an old trace still uses `read` steps + last-step URL (`deriveOutputs` / `deriveSuccess`)
- [x] Tests: compile from a success event with `result`; JSONL round-trip; fallback when payload omitted

---

## Phase 6 — Apps / CLIs

Thin entry points. Packages own behavior.

### Pass 6.1 — `icas-play list`

- [x] Load catalog from `CapabilityRegistry`
- [x] Print id, name, Vendor+Product

### Pass 6.2 — `icas-play describe`

- [x] Print inputs, outputs, steps, success, discoveredOn
- [x] Reviewable by a human without reading raw JSON

### Pass 6.3 — `icas-play run` (strict)

- [x] Parse typed inputs from CLI
- [x] `--url` required; `--tenant` / `--vendor` / `--product` default to `icas-bank`
- [x] Do not infer tenant from the URL
- [x] `resolve({ id, tenant })` requires an existing override (not enrolled → fail)
- [x] Then `ReplayEngine` (no LLM)

### Pass 6.4 — `icas-play run --assist`

- [x] Pass `assist: true` through to replay
- [x] Default remains model-free when the flag is absent
- [x] `--assist` stdout logs system instructions, exact generate prompt, structured response (no API key)

### Pass 6.5 — `icas-agent discover`

- [x] Required: `--id` (unique), `--url`, `--goal`
- [x] Optional: `--vendor` `--product` `--tenant` (default `icas-bank`)
- [x] Refuse if `--id` already exists
- [x] Wire surface, policy, evidence, handoff, compiler
- [x] On success: `save` base + `saveOverride` header-only for the discovering tenant; write discovery evidence

### Pass 6.6 — `icas-adapt` guarded replay

- [x] Replay existing Vendor+Product capability against a new tenant URL
- [x] Stop at first meaningful checkpoint mismatch with expected vs observed

### Pass 6.7 — `icas-adapt` override generation

- [x] Bounded specialization around the divergent region
- [x] Write `CapabilityOverride` with provenance (`createdBy: "icas-adapt"` or `"verified"` if header-only, run id, reason)

### Pass 6.8 — `icas-adapt` re-verify

- [x] Resolve base + override; run `ReplayEngine` again
- [x] Override is verified only if all checkpoints pass

### Pass 6.9 — `icas-adapt` abort to rediscovery

- [x] If divergence is large, downstream preconditions cannot be restored, or the business flow differs, stop
- [x] Do not accumulate a large brittle patch
- [x] `tests/integration/tenant-adaptation.test.ts`

### Pass 6.10 — Pin MCP SDK

- [x] Replace `@modelcontextprotocol/sdk: latest` with a concrete stable version

### Pass 6.11 — MCP server + tool catalog

- [x] Stdio MCP server
- [x] One tool per saved capability; typed args from capability inputs
- [x] Capability schema stays transport-independent

### Pass 6.12 — MCP invoke → ReplayEngine

- [x] Tool call delegates to `ReplayEngine` with resolved effective capability for an enrolled tenant (default `icas-bank`)
- [x] Optional `vendor` / `product` / `tenant` on every tool; defaults from that capability (`discoveredOn.tenant`, `target`); mismatch vs artifact target fails; never inferred from `url`
- [x] Optional `assist` (default false) injects `RepairProposer`; `ICAS_ASSIST_LLM_*`; fail closed without keys; logs on stderr
- [x] No duplicated browser or replay logic

### Pass 6.13 — MCP `business_outcome` copy

Depends on Pass 4.14. Do not duplicate replay matching in the adapter.

- [x] On `business_outcome`, surface `heading` and `summary` from the matching `possibleOutcomes` entry (plus `details.message`, the phrase that hit)
- [x] Evidence still holds the screenshot

### Pass 6.14 — Share Mastra repair proposer (deferred)

`icas-play` and `icas-mcp` each keep a copy of `mastra-repair-proposer.ts`. Leave that until a later refactor. `@icas/replay` stays model-free. `@icas/discovery` stays the discover path. Apps do not import each other.

- [ ] One Mastra `RepairProposer` adapter for `--assist` and MCP `assist`
- [ ] Do not move it into `@icas/replay` or `@icas/discovery`
- [ ] Do not have `icas-mcp` import `icas-play`

---

## Phase 7 — Synthetic tenant apps

`tenants/icas-bank` (happy path + not-found), `tenants/loki-bank` (same product, label drift), `tenants/helix-cu` (different product, share hold, div layout).

Same fictional Vendor+Product: `icas-bank` / `icas-bank`. Tenant catalog id for the default demo is `icas-bank`. The second institution stays a separate app folder. No login flow. No real PII.

### Pass 7.1 — icas-bank app shell

- [x] Runnable app on `http://localhost:4101`
- [x] Workspace package + start script
- [x] Home page

### Pass 7.2 — Deterministic loan records

- [x] In-memory/static loan records including a known good loan and a missing id
- [x] Fields needed for payoff: principal, per-diem, status

### Pass 7.3 — icas-bank search path

- [x] Home → Lending → Loan Account Inquiry
- [x] Search by `loanAccountId` (`LN Acct #`)
- [x] Legacy-ish layout (nested/table, imperfect semantics, inconsistent labels)

### Pass 7.4 — icas-bank payoff path

- [x] Loan details → Payoff → date → Calculate/Generate → statement
- [x] Outputs: `totalPayoffAmount`, `principalBalance`, `perDiemInterest`

### Pass 7.5 — Loki Bank shell + drift

- [x] Runnable on `http://localhost:4102`
- [x] Same product/workflow as icas-bank
- [x] Small UI drift (labels/nav/module names) that fails icas-bank locators/checkpoints at a known step

### Pass 7.6 — `LOAN_NOT_FOUND`

- [x] Unknown loan id shows a domain empty/not-found state (not a crash page)

### Pass 7.7 — Injectable interstitial / slow load

- [x] Transient session-warning or loading overlay that clears without changing intent

### Pass 7.8 — Injectable HITL / manual-review screen

- [x] Ambiguous or approval boundary that automation should not click through
- [x] icas-bank: optional cookie-backed `message=` on `inject=hitl` (and `inject=wait`) so overlay body can match compiled HITL phrases; custom HITL dismiss is **human interacted**

### Pass 7.9 — Helix CU share hold (div layout)

- [x] Runnable on `http://localhost:4103`
- [x] Different vendor/product from icas-bank; no layout tables
- [x] Home → Member Services → Share Holds → Find → Place Hold → confirmation
- [x] Outputs: `holdConfirmationId`, available after hold, hold expiry; unknown member empty state

---

## Phase 8 — End-to-end demo and submission evidence

Discover needs `ICAS_DISCOVERY_LLM_*` in `.env`. Strict replay does not. Each ICAS block exports `ICAS_CAPABILITIES_ROOT` and `ICAS_EVIDENCE_ROOT` so the catalog and traces are not the default-hidden scratch dirs. Evidence lands under `$ICAS_EVIDENCE_ROOT/<capability-id>/<run-id>/`. Catalog files are gitignored; force-add the generated trees when committing. Add `2>&1 | tee …` on the console later if you need a transcript.

### Pass 8.0 — Start servers

- [ ] icas-bank on `:4101`, loki-bank on `:4102`, helix-cu on `:4103`, icas-banc on `:4104`
- [ ] Confirm each responds before 8.1

One tenant per terminal. Leave all four up for the rest of Phase 8. 8.1–8.5 use icas-bank (`:4101`). 8.6 uses icas-bank **enrollment** against icas-banc (`:4104`). 8.7 enrolls icas-banc. 8.8–8.9 use loki-bank (`:4102`). 8.10 uses helix-cu (`:4103`). 8.11–8.12 use icas-bank MCP.

```bash
# Staff payoff UI. Discover, replay, HITL, and MCP default.
pnpm icas-bank
```

```bash
# Same vendor/product as icas-bank; several label/nav changes. Adapt will fail.
pnpm loki-bank
```

```bash
# Different vendor/product. Share-hold, not loan payoff.
pnpm helix-cu
```

```bash
# Same product as icas-bank; Inquire is renamed Look Up.
pnpm icas-banc
```

Check they are listening (expect HTTP 200 from each):

```bash
# Expect HTTP 200 from each tenant before discover.
curl -s -o /dev/null -w 'icas-bank 4101 %{http_code}\n' http://127.0.0.1:4101/
curl -s -o /dev/null -w 'loki-bank 4102 %{http_code}\n' http://127.0.0.1:4102/
curl -s -o /dev/null -w 'helix-cu 4103 %{http_code}\n' http://127.0.0.1:4103/
curl -s -o /dev/null -w 'icas-banc 4104 %{http_code}\n' http://127.0.0.1:4104/
```

If a check is `000` or connection refused, that app is not running. Do not start 8.1 until all four print `200`.

### Pass 8.1 — Real discovery against icas-bank

- [ ] `icas-agent discover` loan-payoff
- [ ] Commit generated capability + discovery trace/observations

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# LLM discovers loan-payoff on icas-bank.
# Writes the catalog plus a header-only enrollment.
pnpm icas-agent \
  discover \
  --id loan-payoff \
  --url http://localhost:4101 \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"
```

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# List saved capabilities after discover.
pnpm icas-play list
```

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Typed replay flags for loan-payoff. Later run commands must match these names.
pnpm icas-play describe loan-payoff
```

### Pass 8.2 — Deterministic replay, different inputs

- [ ] `icas-play run` with a different loan/date than discovery
- [ ] Commit successful replay log; no model decisions

Replay flags are **not** a fixed CLI contract. Discover does not take typed invocation flags. The proposer names fill/select params; compile writes those names onto the artifact. This 8.1 run named them `loanAccountNumber` and `payoffDate` — the blocks below match that describe. If you rediscover, read describe again and adjust the `--` flags. Later 8.3–8.8 (`loan-payoff` replay, assist, both adapts) and 8.11–8.12 must use those same names. 8.9 is `payoff-statement` (describe after that discover). 8.10 is `share-hold`.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Deterministic replay with a different loan than discover.
# No LLM.
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.3 — Business outcome evidence

Depends on Pass 4.14 / 5.19. Replay classifies from compiled `possibleOutcomes`, not an engine enum.

- [ ] Unknown loan → `business_outcome` (heading/summary from the matching entry, not a hardcoded `LOAN_NOT_FOUND` in `ReplayEngine`)
- [ ] Commit exceptional replay log

Use the same `--` input names as 8.2 / describe, not a hardcoded `loanAccountId`.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Unknown loan id. Replay may stop as business_outcome if compiled phrases match,
# or as an error / UNEXPECTED_STATE if they do not. Not a crash.
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountNumber 000000 \
  --payoffDate 2026-09-30
```

### Pass 8.4 — Recoverable interstitial evidence

- [ ] Bounded recovery visible in the log

`?inject=wait` puts a **session-warning** overlay on **Loan Details** (cookie so it survives Home → Inquire). Replay should dismiss **Continue** on its own, wait the short stall, then finish payoff. Do not click the overlay. Do not use `?inject=hitl` (that is 8.5). Omit `message=` so the default “Please wait” / Session warning copy stays; that is what `known_interstitial` matches. (`message=` on wait is for later fixture tests.) The log should show a `known_interstitial` recovery, then success with outputs. Same `--` input names as 8.2 / describe.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Session-warning overlay on Loan Details.
# Replay dismisses Continue on its own, then finishes payoff. Do not click the overlay.
pnpm icas-play \
  run loan-payoff \
  --url "http://localhost:4101/?inject=wait" \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.5 — HITL evidence

- [ ] Pause, same browser, recorded human actions, resume
- [ ] Commit handoff evidence

Default `?inject=hitl` overlay copy (“Supervisor hold” / **Release to servicing**) does **not** match compiled HITL phrases, so replay would stop as `UNEXPECTED_STATE`. Pass `message=` with a substring from the **Inquire** step’s `possibleOutcomes` `kind: "hitl"` entry (this 8.1 artifact: `Permission required to access loan details`). Cookie-backed like `inject`, so the phrase survives Home → Inquire. If you rediscover, re-read that phrase from describe / the artifact and re-encode it.

Do not click **Continue**. In the same headed window click **human interacted**, then press ENTER in the CLI. Same `--` input names as 8.2 / describe.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# HITL overlay whose copy matches a compiled hitl phrase.
# In the same headed window click "human interacted", then press ENTER here.
pnpm icas-play \
  run loan-payoff \
  --url "http://localhost:4101/?inject=hitl&message=Permission%20required%20to%20access%20loan%20details" \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.6 — `--assist` on icas-banc URL (no catalog write)

Depends on Pass 4.17.

- [ ] `icas-play run loan-payoff --assist --tenant icas-bank --url :4104` succeeds
- [ ] Evidence includes `assisted_fallback`; `loan-payoff` overrides are unchanged (no new `icas-banc.json` from this run)

This is **not** `icas-adapt` minus a file. Assist proposes repair **actions** for this session and must rejoin the original path. Adapt writes a `StepOverride` and re-verifies. `--tenant icas-bank` (already enrolled) plus icas-banc’s URL so Inquire misses Look Up. Needs `ICAS_ASSIST_LLM_*` (repo-root `.env` is loaded on start). Same `--` input names as 8.2 / describe.

Do **not** use `--tenant icas-banc` here (that enrollment is 8.7). Overlay unused.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# icas-banc URL, still enrolled as icas-bank.
# Assist repairs Inquire → Look Up for this run only. Does not write an override.
pnpm icas-play \
  run loan-payoff \
  --assist \
  --tenant icas-bank \
  --url http://localhost:4104 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.7 — icas-banc adaptation evidence

- [ ] `icas-adapt` produces a verified override
- [ ] Commit override + adaptation evidence

`tenants/icas-banc` is the same Vendor+Product as icas-bank with **one** search-submit rename (Inquire → Look Up). That is the bounded one-step adapt target (`MAX_ADAPT_PATCH_STEPS = 1`). 8.6 already repaired the same miss **this run only**. This pass **persists** Look Up. Loki’s broader label drift is 8.8 (expected fail) then 8.9 (rediscover as `--id payoff-statement`).

Overlay is unused (happy-path adapt). icas-banc is already on `:4104` from 8.0; icas-bank stays on 4101. Same `--` input names as 8.2 / describe.

Mismatch patches need `ICAS_ADAPT_LLM_*`. Compatible enrollments skip the model; this tenant is expected to miss once, write `createdBy: "icas-adapt"`, then re-verify with `ReplayEngine` (no LLM). `--assist` / `ICAS_ASSIST_LLM_*` do not persist an override.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Persist the Look Up rename as an icas-banc override.
# Re-verify with ReplayEngine (no LLM).
pnpm icas-adapt \
  loan-payoff \
  --tenant icas-banc \
  --url http://localhost:4104 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.8 — Loki adapt expected fail

- [ ] `icas-adapt loan-payoff --tenant loki-bank` patches one step then fails re-verify
- [ ] Override is rolled back; `loan-payoff` catalog is unchanged (icas-banc enrollment stays)

Same Vendor+Product as icas-bank, but Loki has **several** label/nav renames (Lending → Member Lending, Inquire → Search, and more). Adapt still specializes **one** first miss (`MAX_ADAPT_PATCH_STEPS = 1`), then `ReplayEngine` re-verifies the whole flow with no LLM. The next drifted locator fails; enrollment is rolled back. This is not a mismatch counter — do not add one.

`--tenant loki-bank` is required (never defaulted). `--url` only opens `:4102`. Same `--` input names as 8.2 / describe. Needs `ICAS_ADAPT_LLM_*` so the failure is re-verify rollback, not “specializer unset.”

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Loki has several drifted labels. Adapt patches one step, then re-verify fails.
# Enrollment rolls back; loan-payoff catalog is unchanged.
pnpm icas-adapt \
  loan-payoff \
  --tenant loki-bank \
  --url http://localhost:4102 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

Expect stderr `failed re-verify; enrollment was rolled back`. `capabilities/loan-payoff/overrides/loki-bank.json` must not remain.

### Pass 8.9 — Loki rediscover (`payoff-statement`, same Vendor+Product, same goal)

- [ ] `icas-agent discover` with a **new** `--id` against Loki (`:4102`)
- [ ] Header-only override for `--tenant loki-bank` (`createdBy: "discovery"`)
- [ ] `icas-play run` the new id against `:4102`
- [ ] Commit generated capability + discovery/replay evidence

Discover refuses an existing `--id`. Same vendor+product is not an override key. This pass rediscovers the payoff goal as a **new base** after 8.8 showed bounded adapt is not enough. Catalog id is `payoff-statement` (skill name, like `loan-payoff` / `share-hold`). Tenant stays `--tenant loki-bank`. Do **not** reuse `--id loan-payoff` and do **not** put `loki` in the id.

Pass vendor/product/tenant explicitly. Defaults are all `icas-bank`; a Loki URL alone still enrolls the wrong tenant.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# New catalog id on loki-bank after adapt was not enough.
# Same vendor/product and payoff goal. Do not reuse id loan-payoff.
pnpm icas-agent \
  discover \
  --id payoff-statement \
  --url http://localhost:4102 \
  --vendor icas-bank \
  --product icas-bank \
  --tenant loki-bank \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"
```

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Replay flags for payoff-statement. Names may differ from loan-payoff.
pnpm icas-play describe payoff-statement
```

Replay `--` flags come from that describe (names may differ from 8.1). This discover named `loanNumber` and `payoffDate`. `--tenant loki-bank` is required: omitted tenant defaults to `icas-bank`, which is not enrolled on this id. `--url` only opens `:4102`.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Replay the new Loki capability.
# Tenant must be loki-bank; default icas-bank is not enrolled on this id.
pnpm icas-play \
  run payoff-statement \
  --tenant loki-bank \
  --url http://localhost:4102 \
  --loanNumber 112233 \
  --payoffDate 2026-09-30
```

### Pass 8.10 — Helix CU second product

- [ ] `icas-agent discover` share-hold (`--vendor helix --product helix --tenant helix-cu`)
- [ ] `icas-play run --assist` the new id against `:4103`
- [ ] Commit generated capability + discovery/replay evidence

Different vendor/product and a different goal (share hold, div layout). Not an override of `loan-payoff`. Pass identity explicitly; defaults would tag this as icas-bank.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Discover share-hold on helix-cu.
# Different vendor/product and a different goal than payoff.
pnpm icas-agent \
  discover \
  --id share-hold \
  --url http://localhost:4103 \
  --vendor helix \
  --product helix \
  --tenant helix-cu \
  --goal "Place a \$250.00 hold on member 441122 share 01 for pending debit card authorization. Extract the hold confirmation number, available balance after the hold, and the hold expiry date."
```

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Replay flags for share-hold. Share 01 is a compiled click, not a CLI input.
pnpm icas-play describe share-hold
```

Replay `--` flags come from that describe. This discover named `memberNumber`, `holdAmount`, and `holdReason`. `--tenant helix-cu` plus `--vendor helix --product helix` are required (omitted identity defaults to `icas-bank`). `--url` only opens `:4103`. Share `01` is a compiled click, not a CLI input — leave it. A second-member replay is `--memberNumber 330198` (same share click). Do not copy loan flags onto this capability.

The compiled share-row locator copies the snapshot accessible name (`Primary Share Share 01`); `getByText` does not see the space `<br>` inserts in that name. `--assist` repairs that click for this run (`ICAS_ASSIST_LLM_*`). It does not persist an override.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence

# Replay share-hold. Assist repairs the share-row locator miss for this run.
# Does not persist an override.
pnpm icas-play \
  run share-hold \
  --assist \
  --tenant helix-cu \
  --vendor helix \
  --product helix \
  --url http://localhost:4103 \
  --memberNumber 441122 \
  --holdAmount 250.00 \
  --holdReason "pending debit card authorization"
```

### Pass 8.11 — MCP Inspector

- [ ] Inspector lists `loan_payoff` and invokes it through `ReplayEngine`
- [ ] Tool-call evidence under `$ICAS_EVIDENCE_ROOT`

Stdio server (`loan-payoff` → tool `loan_payoff`). Tenant must already be enrolled (`icas-bank` from 8.1). icas-bank must be running. Tool args follow the 8.1 describe names, plus `url` and optional `tenant` / `vendor` / `product` (defaults from that capability). Optional `assist` (default false) uses `ICAS_ASSIST_LLM_*`. Loki / Helix tools are optional; this pass is `loan_payoff` only (leave `assist` off).

Inspector starts the web UI and **spawns** `pnpm icas-mcp` as a stdio child. Do not also run `pnpm icas-mcp` in another terminal. Do not `tee` this command — stdout is the Inspector/MCP pipe. After a tool call, inspect `$ICAS_EVIDENCE_ROOT`. Run from the repo root.

```bash
# MCP Inspector UI. Spawns icas-mcp as a stdio child.
# Invoke loan_payoff with assist off. Do not tee — stdout is the protocol pipe.
npx -y @modelcontextprotocol/inspector \
  -e ICAS_CAPABILITIES_ROOT=$PWD/capabilities \
  -e ICAS_EVIDENCE_ROOT=$PWD/evidence \
  --cwd $PWD \
  pnpm icas-mcp
```

### Pass 8.12 — MCP in Cursor

- [ ] Project `.cursor/mcp.json` launches `pnpm icas-mcp` with catalog/evidence env
- [ ] Agent chat invokes tools (url + tenant / vendor / product explicit; do not infer identity from url)
- [ ] Document the exact host/command in README if it is not already there

Same stdio server as 8.11. Prefer a **project** config so `${workspaceFolder}` works. User-global `~/.cursor/mcp.json` has no repo root — keep absolute paths there (or `${userHome}/…/icas/…`). Do not invent `${ICAS_ROOT}`.

`pnpm icas-mcp` matches 8.11 (tsx). `node apps/icas-mcp/dist/cli.js` is fine after `pnpm build`; rebuild if sources changed.

```json
{
  "mcpServers": {
    "icas": {
      "command": "pnpm",
      "args": ["icas-mcp"],
      "cwd": "${workspaceFolder}",
      "env": {
        "ICAS_CAPABILITIES_ROOT": "${workspaceFolder}/capabilities",
        "ICAS_EVIDENCE_ROOT": "${workspaceFolder}/evidence"
      }
    }
  }
}
```

By this pass, 8.9–8.10 have added Loki / Helix ids. Tools are catalog ids with hyphens → underscores. The agent must pass `url` on the tool call. Omitted `tenant` / `vendor` / `product` default from that capability (`discoveredOn.tenant`, `target`). Override `tenant` for a later enrollment (icas-banc on `loan_payoff`). Helix `share_hold` needs `assist: true` for the share-row locator.

| Ask about | Tool | `tenant` | `vendor` / `product` | `assist` | `url` |
|---|---|---|---|---|---|
| icas-bank payoff | `loan_payoff` | omit | omit | omit | `http://localhost:4101` |
| icas-banc payoff | `loan_payoff` | `icas-banc` | omit | omit | `http://localhost:4104` |
| Loki payoff | `payoff_statement` | omit | omit | omit | `http://localhost:4102` |
| Helix hold | `share_hold` | omit | omit | `true` | `http://localhost:4103` |

Do **not** call `loan_payoff` with `tenant: loki-bank` (that tenant is not enrolled on that id). Replay `--` input names still come from describe; chat can stay natural language.

Example Agent prompts (that tenant’s app must be running):

```text
How much principal balance on loan 112233 as of 2026-09-30 on tenant icas-bank at http://localhost:4101.
```

```text
Payoff statement for loan 112233 on tenant icas-bank is ready — pull total payoff and per-diem at http://localhost:4101.
```

```text
What happens if I look up loan 000000 on icas-bank at http://localhost:4101 for payoff date 2026-09-30?
```

```text
Generate a payoff statement for loan 112233 as of 2026-09-30 on tenant icas-banc at http://localhost:4104.
```

```text
Payoff for loan 112233 as of 2026-09-30 on tenant loki-bank at http://localhost:4102. Use payoff-statement, not loan-payoff.
```

```text
Place a $250.00 hold on member 441122 share 01 for pending debit card authorization on tenant helix-cu at http://localhost:4103. Use share_hold with assist true. Return confirmation id, available after hold, and expiry.
```

### Pass 8.13 — README demo path

- [x] Root README commands match reality; no undocumented setup

Root `README.md` Demo path is the reviewer walkthrough of 8.0–8.12 (no checkboxes, no `tee`). When those commands change, update the README in the same change. Evidence/commit notes stay in this file.

### Pass 8.14 — Optional screen recording

- [ ] Short recording of discovery or HITL if it helps the reviewer

No extra ICAS command. Record the same invocations as 8.1–8.12 as separate shorts (discover, replay `112233`, not-found, wait, HITL, `--assist` on icas-banc URL, icas-banc adapt, Loki adapt-fail, Loki rediscover, Helix share-hold `--assist`, MCP Inspector, Cursor MCP).

---

## Phase 9 — Reviewer report

### Pass 9.1 — Distill `REPORT.md`

- [x] Concise final answers under the seven Interface.AI headings
- [x] Mention tenant overrides / `CapabilityResolver` under schema and multi-tenant
- [x] Keep `docs/` as the detailed source of truth

---

## Working notes (every pass)

- One pass, one commit.
- Apps stay thin; packages own behavior; no core package imports a CLI.
- Saved artifacts must not contain credentials, tokens, or raw sensitive data.
- When in doubt, fail at the checkpoint boundary with evidence rather than improvising.
- Root `README.md` Demo path tracks Phase 8.0–8.12. Update it in the same change when those demo commands change.

