#!/usr/bin/env node
/**
 * @file icas-play — human-facing catalog CLI.
 *
 * Thin wrapper: Commander parses argv, {@link FileSystemCapabilityRegistry}
 * loads rows, stdout prints them. This file must not glob `capabilities/`,
 * implement replay, or infer vendor / product / tenant from `--url`.
 *
 * @see docs/01-system-overview.md
 * @see docs/04-capability-artifact.md
 */

import { Command } from "commander";

import {
  FileSystemCapabilityRegistry,
  type CapabilityRegistry,
} from "@icas/capability";

import { catalogRoot } from "./catalog-root.js";

/**
 * Injectable IO and catalog so tests never touch repo `capabilities/`.
 */
export interface PlayCliDeps {
  registry?: CapabilityRegistry;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

/**
 * Build the Commander program. `list` is the only implemented subcommand
 * in this pass; `describe` / `run` remain placeholders.
 */
export function createPlayProgram(deps: PlayCliDeps = {}): Command {
  const write = deps.stdout ?? ((line: string) => {
    console.log(line);
  });
  const writeErr = deps.stderr ?? ((line: string) => {
    console.error(line);
  });
  const resolveRegistry = (): CapabilityRegistry =>
    deps.registry ?? new FileSystemCapabilityRegistry({ root: catalogRoot() });

  const program = new Command();
  program
    .name("icas-play")
    .description("Human-facing capability catalog and deterministic replay")
    .showHelpAfterError();

  program
    .command("list")
    .description("List the latest capability version per id")
    .option("--vendor <vendor>", "Filter by target.vendor")
    .option("--product <product>", "Filter by target.product")
    .action(async (opts: { vendor?: string; product?: string }) => {
      const registry = resolveRegistry();
      const rows = await registry.list({
        ...(opts.vendor === undefined ? {} : { vendor: opts.vendor }),
        ...(opts.product === undefined ? {} : { product: opts.product }),
      });
      if (rows.length === 0) {
        write("No capabilities in the catalog.");
        return;
      }
      // Header so a human can scan without opening JSON.
      write("id\tname\tvendor/product\tversion");
      for (const row of rows) {
        write(
          `${row.id}\t${row.name}\t${row.target.vendor}/${row.target.product}\t${row.capabilityVersion}`,
        );
      }
    });

  program
    .command("describe")
    .argument("<id>", "Capability id")
    .description("Print one capability (not implemented in this pass)")
    .action(() => {
      writeErr("icas-play describe is not implemented yet.");
      process.exitCode = 1;
    });

  program
    .command("run")
    .argument("<id>", "Capability id")
    .description("Replay a capability (not implemented in this pass)")
    .action(() => {
      writeErr("icas-play run is not implemented yet.");
      process.exitCode = 1;
    });

  return program;
}

/**
 * Parse argv and run the selected subcommand.
 *
 * @param argv - Process argv including node and script, or a test slice
 */
export async function runPlay(
  argv: string[] = process.argv,
  deps: PlayCliDeps = {},
): Promise<void> {
  await createPlayProgram(deps).parseAsync(argv);
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (isMain) {
  void runPlay().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
