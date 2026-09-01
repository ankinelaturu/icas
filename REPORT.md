# ICAS Design Report

Concise answers under the seven Interface.AI headings. Detailed design lives in [`docs/`](docs/).

## 1. Architecture

ICAS splits **goal-driven discovery** from **deterministic production execution**.

`icas-agent discover` always searches a live UI with an LLM (`CandidateProposer` / Mastra `generate` once per DFS node). It never silently replays a stored flow. A successful path is compiled into a typed capability and a header-only tenant override (`overrides: {}`) so play/MCP fail closed until the tenant is enrolled.

`icas-play` / `icas-mcp` / `icas-adapt` resolve `id` + enrolled `tenant` through `CapabilityResolver`, then hand the **effective** artifact to `ReplayEngine`. Strict replay has no LLM unless `--assist`. Apps stay thin; packages own behavior. Playwright is the first `Surface`, not the artifact model.

Must-have slice: discover → artifact + enrollment → replay, exceptional-state classification, HITL, evidence. Stretch already in-repo: `--assist`, `icas-adapt`, MCP. Deferred on purpose: phrase embeddings (4.15), screenshot pixels on `generate` (5.22).

## 2. Artifact schema

A capability is a serializable contract, not a transcript. Identity is catalog `id` only (one `capability.json` per id). `schemaVersion` is the JSON format (`"1.0"`). Vendor+Product names the app family. Tenant identity and patches live on a separate override file (`baseCapability` is the catalog id).

The artifact carries typed inputs/outputs, ordered steps (semantic actions + ranked locators + optional checkpoints), overall `success` assertions, and optional per-step `possibleOutcomes` (`kind` `error` | `hitl` after compile; `match.phrases`; nullable `heading`/`summary` for tools/HITL, never locators). Compile drops `kind: "success"`. `CapabilityResolver` applies declarative `StepOverride` patches; `ReplayEngine` never branches on tenant.

## 3. Determinism & error handling

Replay hydrates `ValueRef`s, checks preconditions, policy-gates execute, then uses the **next** step’s locator as the happy-path gate. That locator found → continue (do not scan outcomes). Missing → document HTTP 403/404 fail before phrases; 5xx retries a known interstitial then fails; otherwise walk this step’s `possibleOutcomes` (OR phrases, skip `success`), then a tiny runtime generic-chrome list. `error` returns `business_outcome` with heading/summary/match/phrase in `details`. `hitl` pauses the same session. This step’s own target miss is `TARGET_NOT_FOUND`, not this step’s outcome list. Last-step overall `success` miss uses the same classifier. Optional `--assist` is one bounded, policy-checked repair, then rejoin.

## 4. Heterogeneity & multi-tenant

`Surface` keeps Playwright behind observation/action/assert/locate. A later desktop driver can map the same semantics.

Vendor+Product is reuse identity. Tenant is enrollment + optional locator/checkpoint/`possibleOutcomes` patch. First discover writes base **and** a header-only override. `icas-adapt` guarded-replays against a new tenant URL, writes a bounded override (`createdBy: "icas-adapt"` or `"verified"`), and re-verifies with `ReplayEngine`. Large flow divergence aborts to rediscovery rather than a brittle mega-patch. `--vendor` / `--product` / `--tenant` default to `icas-bank` on discover/play; they are never inferred from `--url`. Adapt requires `--tenant`.

## 5. Escalation & handoff

HITL is control transfer of the **same** headed session, not a co-browsing console. Discovery requests intervention when stuck, ambiguous, risky, or policy-blocked. Replay pauses when policy requires a human, assist is exhausted, or a compiled `possibleOutcomes` `hitl` entry matches. `HandoffController` tracks owner; automation actions are rejected while `human` owns control. CLI stdin approval and browser takeover both record `actor: human` evidence, then resume explicitly.

## 6. Safety

Defense in depth: injectable markdown prompt policy (`ICAS_PROMPT_POLICY`), `PolicyGuard` action/origin allowlists, independent risky-text checks (do not trust model self-classification), and `Redactor` profiles before model payload, evidence, and terminal output. Artifacts and logs must not contain credentials, tokens, or PII. Synthetic tenants only. MCP formats `business_outcome` from replay `details`; it does not rematch the page. Evidence still holds the screenshot.

## 7. Cuts

Out of scope: production co-browsing/operator console, distributed queues, real bank credentials, a second (desktop) surface implementation, REST/DB capability registries, inferring tenant from URL. Phrase embeddings and attaching screenshot pixels to `generate` are deferred, not abandoned. The focus is the complete vertical slice above, with stretch (assist, adapt, MCP) implemented in-repo rather than skipped to polish extras.
