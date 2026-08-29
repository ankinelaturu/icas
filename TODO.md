# ICAS Implementation TODO

Living checklist for filling in the scaffold. Design source of truth is `docs/`. Update the relevant design note in the same change if an architectural decision shifts.

**Commit rule:** one pass = one commit. Do not combine passes. Each pass should be reviewable on its own and leave the repo building/typechecking.

**Agreed constraints**

- Implementation order: capability → surface/browser → replay → discovery/compiler, then apps.
- Add fixtures and tests in the same pass that introduces the behavior.
- Full tenant apps: icas-bank is in; a second institution comes later (Phase 7).
- Model/provider (including vision) is deferred until discovery needs it (Phase 5).
- Assisted fallback, `icas-adapt`, HITL browser takeover, and MCP are in scope.
- Tenant specialization is a declarative `CapabilityOverride` resolved by `CapabilityResolver`. `ReplayEngine` stays tenant-agnostic.
- Every discovered or verified tenant gets an override file (empty patch allowed). `icas-play` / MCP require enrollment.
- CLI: `--id` is the unique catalog name. `--vendor` / `--product` / `--tenant` default to `icas-bank`. Do not infer them from `--url`.
- Do not commit `docs/brief.pdf` (gitignored).

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
- [x] No runtime yet; types only

### Pass 1.2 — Base capability schema validation

- [x] Validate required fields, versions, inputs/outputs, step shape, action vocabulary, assertion families
- [x] Clear errors for invalid artifacts
- [x] Distinguish `schemaVersion` vs `capabilityVersion`
- [x] Tests: valid `tests/fixtures/loan-payoff.capability.json` passes; truncated/unknown-action fixtures fail
- [x] Add package Vitest config in this pass (first tests in the package)

### Pass 1.3 — Input/output type helpers

- [x] Validate values against `string` | `number` | `boolean` | `date` | `money`
- [x] Resolve `ValueRef` (`input` vs `literal`) given an input map
- [x] Tests for each primitive and for missing/invalid refs

### Pass 1.4 — Override schema validation

- [x] Validate override shape, required `baseCapability` version pin, tenant target, provenance
- [x] Reject executable / `customJavaScript`-style patches
- [x] Tests: valid override fixture; JS-patch rejection; missing base version pin

### Pass 1.5 — Filesystem capability registry

- [x] Implement `CapabilityRegistry` plus `FileSystemCapabilityRegistry({ root })` as specified in `docs/04-capability-artifact.md`
- [x] `list` (latest per id, optional vendor/product filter), `get(id, version?)`, `save` (upsert + validate), `remove`
- [x] On-disk layout: `capabilities/<id>/<version>.json`
- [x] Do not bake tenant identity into the base artifact
- [x] Tests against a temp directory (not the real `capabilities/` submission dir)

### Pass 1.6 — Override storage and registry

- [x] On-disk layout: `capabilities/<id>/overrides/<tenant>.json` pinned to `id@version`
- [x] Empty `overrides: {}` is valid (header-only enrollment)
- [x] `listOverrides` / `getOverride` / `saveOverride` / `removeOverride`
- [x] `saveOverride` rejects if the pinned base version is not stored
- [x] Tests for round-trip save/load and header-only override

### Pass 1.7 — Resolver: version pin + whole-step replace

- [x] `CapabilityResolver`: load base + tenant override
- [x] Refuse mismatched `baseCapability` version (never apply silently)
- [x] Apply whole-step replace
- [x] Schema-validate the effective capability before returning it
- [x] Tests: happy replace; version mismatch; invalid resolved artifact rejected

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

---

## Phase 2 — Surface and browser

`packages/surface`, `packages/browser`

### Pass 2.1 — HTML fixtures

- [x] Static pages under `tests/fixtures/` for home / lending / loan-search / labeled fields
- [x] Enough markup to exercise role+text, label, and visible-text strategies
- [x] No full tenant app yet

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
- [x] Full CLI takeover UX waits for Phase 3 / 4

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

- [ ] `run(effectiveCapability, inputs, options)` iterates steps
- [ ] Return structured `ExecutionResult` (`success` | `business_outcome` | `failure`) with `runId`
- [ ] Stub step execution; tests for empty-steps success and missing-capability failure shape

### Pass 4.2 — Preconditions

- [ ] Evaluate each step’s preconditions via `Surface.assert`
- [ ] Fail with `PRECONDITION_FAILED`, `stepId`, expected vs observed
- [ ] Tests: pass-through vs first-step mismatch

### Pass 4.3 — Policy gate before execute

- [ ] Every action goes through `PolicyGuard`
- [ ] `POLICY_BLOCKED` on deny; HITL path not wired yet (return structured failure)
- [ ] Tests: allowed action executes; denied action never hits `Surface.execute`

### Pass 4.4 — Execute + postconditions

- [ ] Execute through `Surface`
- [ ] Evaluate postconditions
- [ ] Fail with `POSTCONDITION_FAILED` or `TARGET_NOT_FOUND`
- [ ] Tests: action+postcondition happy path; postcondition mismatch

### Pass 4.5 — Success condition + output extraction

- [ ] Overall `success` assertions after all steps
- [ ] Extract declared outputs; validate types via Pass 1.3 helpers
- [ ] `OUTPUT_EXTRACTION_FAILED` when missing/invalid
- [ ] Tests: typed outputs; extraction failure

### Pass 4.6 — Business outcomes

- [ ] Domain results such as `LOAN_NOT_FOUND`, `PAYOFF_NOT_AVAILABLE`, `INVALID_PAYOFF_DATE`, `LOAN_ALREADY_PAID`
- [ ] Return `business_outcome`, not a Playwright exception
- [ ] Tests: fixture that presents “loan not found” maps to `LOAN_NOT_FOUND`

### Pass 4.7 — Recoverable waits / retries

- [ ] Bounded retry for transient load, known interstitial, retryable timeout
- [ ] Log recovery in evidence
- [ ] Do not retry semantic mismatches
- [ ] Tests: interstitial then success; semantic fail does not retry forever

### Pass 4.8 — Hard failures + evidence

- [ ] Codes: `PRECONDITION_FAILED`, `TARGET_NOT_FOUND`, `POSTCONDITION_FAILED`, `POLICY_BLOCKED`, `UNEXPECTED_STATE`, `OUTPUT_EXTRACTION_FAILED`
- [ ] Capture rich evidence at the failure boundary
- [ ] Tests: each code at least once with `stepId` / expected / observed

### Pass 4.9 — Replay HITL

- [ ] Emit intervention when policy requires human, state is unrecoverable, or assist is disabled/exhausted
- [ ] Same browser session stays alive
- [ ] Tests: risky encoded action pauses; resume continues from the same step contract

### Pass 4.10 — Assisted fallback (repair)

- [ ] `--assist` / `options.assist`: on one failed step, freeze context and ask model for a bounded repair
- [ ] Run proposed actions through `PolicyGuard` and a strict budget
- [ ] Record as assisted-fallback evidence, not deterministic actions
- [ ] Tests: policy-blocked repair is not executed; budget exceeded stops

### Pass 4.11 — Assisted fallback (rejoin)

- [ ] After repair, verify the failed step’s postconditions and the next original step’s preconditions
- [ ] Rejoin deterministic path only if both pass; otherwise stop
- [ ] Tests: successful rejoin; failed rejoin does not continue inventing steps

### Pass 4.12 — Replay integration tests

- [ ] `tests/integration/capability-replay.test.ts`
- [ ] `tests/integration/loan-not-found.test.ts`
- [ ] `tests/integration/assisted-fallback.test.ts`
- [ ] Against HTML fixtures, not full tenants

---

## Phase 5 — Discovery and compiler

`packages/discovery` (Mastra `@mastra/core@1.63.0`)

ICAS owns search state, budget, trace, and compiler. Mastra is the LLM/tool layer only.

### Pass 5.1 — Candidate action schema

- [ ] `CandidateAction` type: action, rationale, rank, optional expectation/risk
- [ ] Schema-validate model output; reject free-form prose
- [ ] Tests: valid candidate; malformed payload rejected

### Pass 5.2 — Search state and budgets

- [ ] `SearchNode` (state id, observation, candidates, tried ids, parent)
- [ ] Limits: max steps, max depth, max candidates per state, timeout
- [ ] Tests: budget fields exist and are applied as numbers (enforcement in later passes)

### Pass 5.3 — Discovery loop skeleton (no live model)

- [ ] `DiscoveryAgent.run` always discovers (never silent replay)
- [ ] Loop: observe → (stub) candidates → policy → execute → record → stop on budget
- [ ] Tests with a fake proposer: one successful click path; timeout stop

### Pass 5.4 — Mastra tool/LLM adapter

- [ ] Wire Mastra for structured candidate generation
- [ ] Pin extra `@mastra/*` packages only if needed, to concrete versions (not `latest`)
- [ ] Keep search controller in ICAS, not in Mastra memory
- [ ] Test: adapter returns schema-validated candidates from a mocked model

### Pass 5.5 — Model / vision provider

- [ ] Choose and document default provider/model (image-capable if observations are screenshots)
- [ ] Env: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ICAS_MODEL`
- [ ] Inject prompt policy from Pass 3.1
- [ ] Smoke test behind a flag or recorded fixture if CI has no keys

### Pass 5.6 — Ranked bounded search

- [ ] Try highest-ranked untried candidate first
- [ ] Enforce max steps/depth/candidates
- [ ] Tests: rank order; depth limit stops expansion

### Pass 5.7 — Repeated state and backtrack accounting

- [ ] Detect repeated states
- [ ] Track tried candidates; backtrack to next sibling
- [ ] Tests: dead-end then sibling tried; repeated state does not loop

### Pass 5.8 — Backtrack restore

- [ ] Do not assume `page.goBack()` restores SPA/modal/POST state
- [ ] Restore via history when reliable, else replay known prefix from entry URL
- [ ] Test on a fixture where history-back is insufficient

### Pass 5.9 — Discovery HITL

- [ ] Request intervention when stuck, ambiguous, risky, or policy-blocked
- [ ] Resume into the same search node
- [ ] Tests: policy-block → intervention; resume continues

### Pass 5.10 — Discovery trace

- [ ] Append-only JSONL: observation, ranked candidates, chosen action, policy, result, dead-end, backtrack, intervention, success
- [ ] Screenshots referenced from the trace
- [ ] Test: fixture run produces expected event types in order

### Pass 5.11 — Compiler: successful path only

- [ ] Read a fixture trace; drop failed branches from the executable artifact
- [ ] Failed branches remain evidence-only
- [ ] Test: trace with a dead-end then success compiles only the success steps

### Pass 5.12 — Compiler: parameterize inputs

- [ ] Replace concrete discovery values with `ValueRef` input references
- [ ] Test: loan id `987654` in the trace becomes `{ "input": "loanAccountId" }`

### Pass 5.13 — Compiler: targets, checkpoints, outputs, versions

- [ ] Derive semantic targets, pre/post, output extraction, overall success
- [ ] Attach `schemaVersion` / `capabilityVersion` / Vendor+Product identity
- [ ] Write via `CapabilityRegistry`
- [ ] Test: compiled artifact passes Pass 1.2 validation

### Pass 5.14 — Compiler: human actions

- [ ] Recurring approval → explicit `handoff` step
- [ ] Exceptional manual recovery stays evidence, not happy-path
- [ ] Tests for both classifications

### Pass 5.15 — Discovery integration test

- [ ] `tests/integration/discovery-to-capability.test.ts`
- [ ] Fake or recorded model + HTML fixtures → validated capability file

---

## Phase 6 — Apps / CLIs

Thin entry points. Packages own behavior.

### Pass 6.1 — `icas-play list`

- [ ] Load catalog from `CapabilityRegistry`
- [ ] Print id, name, Vendor+Product, version

### Pass 6.2 — `icas-play describe`

- [ ] Print inputs, outputs, steps, success, discoveredOn
- [ ] Reviewable by a human without reading raw JSON

### Pass 6.3 — `icas-play run` (strict)

- [ ] Parse typed inputs from CLI
- [ ] `--url` required; `--tenant` / `--vendor` / `--product` default to `icas-bank`
- [ ] Do not infer tenant from the URL
- [ ] `resolve({ id, tenant })` requires an existing override (not enrolled → fail)
- [ ] Then `ReplayEngine` (no LLM)

### Pass 6.4 — `icas-play run --assist`

- [ ] Pass `assist: true` through to replay
- [ ] Default remains model-free when the flag is absent

### Pass 6.5 — `icas-agent discover`

- [ ] Required: `--id` (unique), `--url`, `--goal`
- [ ] Optional: `--vendor` `--product` `--tenant` (default `icas-bank`)
- [ ] Refuse if `--id` already exists unless version bump is explicit
- [ ] Wire surface, policy, evidence, handoff, compiler
- [ ] On success: `save` base + `saveOverride` header-only for the discovering tenant; write discovery evidence

### Pass 6.6 — `icas-adapt` guarded replay

- [ ] Replay existing Vendor+Product capability against a new tenant URL
- [ ] Stop at first meaningful checkpoint mismatch with expected vs observed

### Pass 6.7 — `icas-adapt` override generation

- [ ] Bounded specialization around the divergent region
- [ ] Write `CapabilityOverride` with provenance (`createdBy: "icas-adapt"` or `"verified"` if header-only, run id, reason)

### Pass 6.8 — `icas-adapt` re-verify

- [ ] Resolve base + override; run `ReplayEngine` again
- [ ] Override is verified only if all checkpoints pass

### Pass 6.9 — `icas-adapt` abort to rediscovery

- [ ] If divergence is large, downstream preconditions cannot be restored, or the business flow differs, stop
- [ ] Do not accumulate a large brittle patch
- [ ] `tests/integration/tenant-adaptation.test.ts` (fixtures; full Loki Bank in Phase 7)

### Pass 6.10 — Pin MCP SDK

- [ ] Replace `@modelcontextprotocol/sdk: latest` with a concrete stable version
- [ ] No server behavior yet

### Pass 6.11 — MCP server + tool catalog

- [ ] Stdio MCP server
- [ ] One tool per saved capability; typed args from capability inputs
- [ ] Capability schema stays transport-independent

### Pass 6.12 — MCP invoke → ReplayEngine

- [ ] Tool call delegates to `ReplayEngine` with resolved effective capability for an enrolled tenant (default `icas-bank`)
- [ ] No duplicated browser or replay logic

---

## Phase 7 — Synthetic tenant apps

`tenants/icas-bank` (happy path + not-found), `tenants/loki-bank` (same product, label drift).

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

- [ ] Transient session-warning or loading overlay that clears without changing intent

### Pass 7.8 — Injectable HITL / manual-review screen

- [ ] Ambiguous or approval boundary that automation should not click through

---

## Phase 8 — End-to-end demo and submission evidence

Do not hand-author `capabilities/` merely to look complete. Commit artifacts produced by real runs.

### Pass 8.1 — Real discovery against icas-bank

- [ ] `icas-agent discover` loan-payoff
- [ ] Commit generated capability + discovery trace/observations

### Pass 8.2 — Deterministic replay, different inputs

- [ ] `icas-play run` with a different loan/date than discovery
- [ ] Commit successful replay log; no model decisions

### Pass 8.3 — Business outcome evidence

- [ ] Unknown loan → `LOAN_NOT_FOUND`
- [ ] Commit exceptional replay log

### Pass 8.4 — Recoverable interstitial evidence

- [ ] Bounded recovery visible in the log

### Pass 8.5 — HITL evidence

- [ ] Pause, same browser, recorded human actions, resume
- [ ] Commit handoff evidence

### Pass 8.6 — Loki Bank adaptation evidence

- [ ] `icas-adapt` produces a verified override
- [ ] Commit override + adaptation evidence

### Pass 8.7 — MCP demo

- [ ] Host discovers `loan_payoff` and invokes it through `ReplayEngine`
- [ ] Document the exact host/command in README if not already there

### Pass 8.8 — README demo path

- [ ] Root README commands match reality; no undocumented setup

### Pass 8.9 — Optional screen recording

- [ ] Short recording of discovery or HITL if it helps the reviewer

---

## Phase 9 — Reviewer report

### Pass 9.1 — Distill `REPORT.md`

- [ ] Concise final answers under the seven Interface.AI headings
- [ ] Mention tenant overrides / `CapabilityResolver` under schema and multi-tenant
- [ ] Keep `docs/` as the detailed source of truth

---

## Working notes (every pass)

- One pass, one commit.
- Apps stay thin; packages own behavior; no core package imports a CLI.
- Saved artifacts must not contain credentials, tokens, or raw sensitive data.
- When in doubt, fail at the checkpoint boundary with evidence rather than improvising.
