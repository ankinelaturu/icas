#!/usr/bin/env node
/**
 * @file icas-adapt — cross-tenant specialization CLI (scaffold).
 *
 * Separates tenant enrollment from both full discovery and production replay.
 * `--tenant` is required here; do not default it to `icas-bank` when
 * specializing a second institution. `--vendor` / `--product` still default
 * to `icas-bank`. Do not mint a new capability id or re-run the natural-
 * language goal as discovery.
 *
 * Stay thin: guarded `ReplayEngine` first, then bounded patch + re-verify.
 * Compatible adapt still writes a header-only override. Material flow
 * divergence stops adaptation rather than accumulating a brittle patch.
 *
 * @see docs/01-system-overview.md
 * @see docs/06-multi-tenant-and-adaptation.md
 */

console.log("icas-adapt scaffold");
console.log("Planned: icas-adapt <id> --tenant <t> --url <u> (vendor/product default icas-bank); enroll header-only or patch.");
