# ICAS Design Report

Concise answers under the seven Interface.AI headings. Detailed design lives in [`docs/`](docs/).

## 1. Architecture

Discovery learns the contract. Replay implements the contract. MCP exposes the contract to other agents.

ICAS splits **goal-driven discovery** from **deterministic production execution**. `icas-agent discover` always searches a live UI with an LLM (`CandidateProposer` / Mastra `generate` once per DFS node). It never silently replays a stored flow. A successful path compiles into a typed capability. Discover also writes a header-only tenant override (`overrides: {}`): that enrolls the discovering tenant without copying tenant chrome into the Vendor+Product base, so play/MCP fail closed until the tenant is enrolled.

`icas-play` / `icas-mcp` / `icas-adapt` resolve `id` + enrolled `tenant` through `CapabilityResolver`, then hand the **effective** artifact to `ReplayEngine`. Strict replay has no LLM unless `icas-play --assist` or MCP `assist: true`. Apps stay thin; packages own behavior. Playwright is the first `Surface`, not the artifact model. `--url` is runtime environment (where this instance is). It is not catalog identity and is never inferred from vendor/product/tenant; the same enrolled tenant can sit at different entry points.

Trade-offs we took: a filesystem catalog (`FileSystemCapabilityRegistry`) instead of REST/DB, so the submission stays a git tree and callers never glob `capabilities/`. Replay treats the **next** step’s locator as the happy-path gate instead of scanning `possibleOutcomes` first, so a visible error banner does not abort a page that still has Payoff. Missing enrollment fails closed instead of silently replaying the bare base, so an unpatched tenant cannot look like a verified reuse.

The system implements discover → artifact + enrollment → replay, exceptional-state classification, HITL, and evidence. Also in-repo: `--assist` / MCP `assist`, `icas-adapt`, MCP. Deferred: phrase embeddings (4.15), screenshot pixels on `generate` (5.22).

## 2. Artifact schema

A capability is a serializable contract, not a transcript. Identity is catalog `id` only (one `capability.json` per id). `schemaVersion` is the JSON format (`"1.0"`). Vendor+Product names the app family. Tenant identity and patches live on a separate override file (`baseCapability` is the catalog id).

The artifact carries typed inputs/outputs, ordered steps (semantic actions + ranked locators + optional checkpoints), overall `success` assertions, and optional per-step `possibleOutcomes` (`kind` `error` | `hitl` after compile; `match.phrases`; nullable `heading`/`summary` for tools/HITL, never locators). Compile drops `kind: "success"`. `CapabilityResolver` applies declarative `StepOverride` patches; `ReplayEngine` never branches on tenant.

## 3. Determinism & error handling

Happy-path evidence wins first. Exceptional-state classification runs only when the expected next state is absent.

Replay hydrates `ValueRef`s, checks preconditions, and policy-gates execute. For every step except the last, the **next** step’s locator is that next state: found → continue (do not scan outcomes). Missing → document HTTP 403/404 fail before phrases; 5xx retries a known interstitial then fails; otherwise walk this step’s `possibleOutcomes` (OR phrases, skip `success`), then a tiny runtime generic-chrome list. A compiled `error` phrase that is visible returns `business_outcome` with heading/summary/match/phrase in `details`. The engine does not invent product copy (`LOAN_NOT_FOUND`). If no phrase hits, the run is `failure` / `UNEXPECTED_STATE`. `hitl` pauses the same session. This step’s own target miss is `TARGET_NOT_FOUND`, not this step’s outcome list. Last-step overall `success` miss uses the same classifier; after HITL resume, replay re-checks overall success once (it does not scan outcomes again). Optional `--assist` / MCP `assist` is one bounded, policy-checked repair, then rejoin.

## 4. Heterogeneity & multi-tenant

`Surface` keeps Playwright behind observation/action/assert/locate. A later desktop driver can map the same semantics.

Vendor+Product is reuse identity. Tenant is enrollment + optional locator/checkpoint/`possibleOutcomes` patch. First discover writes base **and** a header-only override. `--vendor` / `--product` / `--tenant` default to `icas-bank` on discover/play; they are never inferred from `--url`. `--url` only opens this run’s surface. Adapt requires `--tenant`. MCP identity defaults from that capability (`discoveredOn.tenant`, `target`); an explicit `tenant` still wins.

Four synthetic staff UIs prove the split: `icas-bank` (`:4101`) is discover + strict replay. `icas-banc` (`:4104`) is the same vendor/product with one rename (Inquire → Look Up); `--assist` repairs that run without a catalog write, then `icas-adapt` persists a one-step override and re-verifies. `loki-bank` (`:4102`) has several label/nav changes; bounded adapt fails re-verify and rolls back, so the payoff goal is rediscovered as `payoff-statement`. `helix-cu` (`:4103`) is a different vendor/product (`share-hold`). Adapt stays one-step on purpose: small drift gets a small declarative override; substantial divergence would turn adapt into hidden rediscovery, so ICAS rolls back and requires a new discover.

## 5. Escalation & handoff

HITL is control transfer of the **same** headed session, not a co-browsing console. Discovery requests intervention when stuck, ambiguous, risky, or policy-blocked. Replay pauses when policy requires a human, assist is exhausted, or a compiled `possibleOutcomes` `hitl` entry matches. `HandoffController` tracks owner; automation actions are rejected while `human` owns control. CLI stdin approval and browser takeover both record `actor: human` evidence, then resume explicitly.

## 6. Safety

Defense in depth: injectable markdown prompt policy (`ICAS_PROMPT_POLICY`), `PolicyGuard` action/origin allowlists, independent risky-text checks (do not trust model self-classification), and `Redactor` profiles before model payload, evidence, and terminal output. Artifacts and logs must not contain credentials, tokens, or PII. Synthetic tenants only. MCP is the same resolver + `ReplayEngine` as play (stdio; optional `assist` reads `ICAS_ASSIST_LLM_*` from the process / repo `.env`, not tool args). It formats `business_outcome` from replay `details`; it does not rematch the page. Evidence still holds the screenshot.

## 7. Cuts

Out of scope: production co-browsing/operator console, distributed queues, real bank credentials, a second (desktop) surface implementation, REST/DB capability registries, inferring tenant from URL. Phrase embeddings and attaching screenshot pixels to `generate` are deferred, not abandoned. Live-discover limits we do not hide: compiled `possibleOutcomes` phrases can miss page chrome (unknown loan may be `UNEXPECTED_STATE`); Helix share-row `visibleText` vs accessible name needs `--assist` / MCP `assist: true` for that run.
