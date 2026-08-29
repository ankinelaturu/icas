#!/usr/bin/env node
/**
 * @file icas-agent — discovery CLI (scaffold).
 *
 * This app always discovers. It must not silently replay a stored capability,
 * infer `--id` / vendor / product / tenant from `--url`, or author catalog
 * JSON by hand. `--id` names the Vendor+Product capability; a later
 * institution uses `icas-adapt`, not a second discover with a new id.
 *
 * Stay thin: parse required `--id`, `--url`, `--goal` (vendor / product /
 * tenant default to `icas-bank`) and delegate to `DiscoveryAgent` plus the
 * compiler in packages. On success the compiler writes the base **and** a
 * header-only tenant override (`overrides: {}`).
 *
 * @see docs/01-system-overview.md
 * @see docs/03-discovery-agent.md
 */

console.log("icas-agent scaffold");
console.log("Planned: discover --id <id> --url <u> --goal <goal> [--vendor|--product|--tenant, default icas-bank]");
