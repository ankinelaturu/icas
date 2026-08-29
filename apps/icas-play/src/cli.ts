#!/usr/bin/env node
/**
 * @file icas-play — human-facing catalog CLI (scaffold).
 *
 * This app stays thin: parse argv, resolve through `@icas/capability`, then
 * hand an **effective** artifact to `ReplayEngine`. Behavior lives in
 * packages; this file must not glob `capabilities/`, implement replay, or
 * infer vendor / product / tenant from `--url`.
 *
 * `run` selects by capability id. `--url` only opens the surface. Strict
 * replay is model-free unless the caller passes `--assist`. A missing tenant
 * override means not enrolled — fail closed, never silently use the bare
 * Vendor+Product base.
 *
 * @see docs/01-system-overview.md
 * @see docs/05-replay-engine.md
 */

const [, , command = "help"] = process.argv;

switch (command) {
  case "list":
    // Planned: `CapabilityRegistry.list()`, not a filesystem glob from this app.
    console.log("icas-play list scaffold: load capabilities/*.json and print catalog");
    break;
  case "describe":
    // Planned: print one artifact plus enrollment; still registry-backed.
    console.log("icas-play describe scaffold");
    break;
  case "run":
    // Planned: `CapabilityResolver.resolve({ id, tenant })` then ReplayEngine.
    // `--tenant` defaults to icas-bank. `--assist` is the only LLM path.
    console.log("icas-play run scaffold: run <id> --url <u> ...typed inputs... [--tenant default icas-bank] [--assist]");
    break;
  default:
    console.log("Usage: icas-play <list|describe|run>");
}
