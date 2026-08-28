# ICAS Design Report

> This file intentionally follows the seven headings requested by Interface.AI. It is currently a scaffold; concise final content should be distilled from the detailed documents under `docs/` once the implementation is complete.

## 1. Architecture

ICAS separates goal-driven discovery from deterministic production execution. `icas-agent` performs genuine LLM-driven computer-use discovery against a live surface. A successful discovery is compiled into a typed capability artifact. `icas-play` executes that artifact without model decisions by default. Shared packages isolate capability semantics, browser/surface control, replay, policy, redaction, evidence, and human handoff.

## 2. Artifact schema

A capability is a versioned contract containing vendor/product identity, typed inputs, typed outputs, ordered steps, target descriptions, step preconditions, actions, postconditions, and overall success/output extraction rules. Tenant compatibility is tracked separately from the base vendor/product identity so the same capability can be verified or specialized across institutions running the same product.

## 3. Determinism & error handling

Replay validates each step before and after execution, uses stable target resolution rather than raw model transcripts, verifies success, extracts declared outputs, and returns a structured result. Outcomes are separated into business outcomes, recoverable runtime conditions, and hard failures. Optional assisted fallback allows one bounded, policy-checked LLM repair of a failed step, then requires re-entry into the original deterministic path.

## 4. Heterogeneity & multi-tenant

The capability model is decoupled from Playwright through a surface abstraction. The implemented surface is browser-based, but the same semantic actions/targets/checkpoints can be mapped to accessibility or desktop automation in the future. Vendor + product identifies the app family; tenant identifies a specific institution deployment. Same-product capabilities are candidates for reuse, not assumed-compatible artifacts. Tenant drift is detected through guarded replay and can be handled by specialization.

## 5. Escalation & handoff

Automation can pause and transfer control of the same live headed browser session to a human. The runtime tracks who owns control, emits an intervention request carrying context, records human actions/state changes, and resumes automation after an explicit return-of-control signal. CLI approval/input and full browser takeover are both supported interaction patterns.

## 6. Safety

Safety uses defense in depth: injectable prompt policy, runtime allowlist/policy checks, conservative handling of risky actions, origin/route restrictions where applicable, and a dedicated redaction layer before data is sent to logs/evidence or other external boundaries. Saved artifacts do not contain credentials, tokens, or raw sensitive data.

## 7. Cuts

The implementation intentionally avoids production co-browsing infrastructure, distributed queues/workers, real bank credentials, and full multi-tenant plumbing. Synthetic tenant applications are used instead. The focus remains on the complete vertical slice: real LLM discovery, capability generation, deterministic replay, runtime error handling, safety, handoff, and evidence.
