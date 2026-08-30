#!/usr/bin/env node
/**
 * @file icas-play — human-facing catalog CLI.
 *
 * Thin wrapper: Commander parses argv, {@link FileSystemCapabilityRegistry}
 * loads rows, {@link CapabilityResolver} enrolls replay, {@link ReplayEngine}
 * executes. This file must not glob `capabilities/`, implement DFS, or infer
 * vendor / product / tenant from `--url`.
 *
 * @see docs/01-system-overview.md
 * @see docs/04-capability-artifact.md
 */

import { Command, CommanderError } from "commander";

import {
  CapabilityResolveError,
  CapabilityTypeError,
  FileSystemCapabilityRegistry,
  type CapabilityRegistry,
} from "@icas/capability";
import type { ExecutionResult, RepairProposer } from "@icas/replay";

import { catalogRoot } from "./catalog-root.js";
import { coerceInputValues } from "./coerce-inputs.js";
import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import { formatCapabilityDescription } from "./format-describe.js";
import { exitCodeForResult, formatRunResult } from "./format-run-result.js";
import { loadRepoEnv } from "./load-repo-env.js";
import { parseCapabilityInputFlags } from "./parse-cli-inputs.js";
import {
  runEnrolledReplay,
  type PlayReplayInvocation,
  type PlayRunRequest,
} from "./replay-session.js";

/**
 * Injectable IO and catalog so tests never touch repo `capabilities/` or Chromium.
 */
export interface PlayCliDeps {
  registry?: CapabilityRegistry;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /**
   * Replace Playwright + ReplayEngine. Tests assert resolve + typed inputs
   * without launching a browser.
   */
  executeReplay?: (invocation: PlayReplayInvocation) => Promise<ExecutionResult>;
  /** Injected RepairProposer for `--assist` tests; production builds Mastra. */
  repair?: RepairProposer;
  /** Override process.env when resolving headed vs headless. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Repeatable `--input name=value` collector for Commander.
 *
 * @param value - One `name=value` token
 * @param previous - Tokens already collected
 */
function collectInput(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Build the Commander program.
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
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        write(str.replace(/\n$/, ""));
      },
      writeErr: (str) => {
        writeErr(str.replace(/\n$/, ""));
      },
    });

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
    .option("--version <semver>", "Pin a capabilityVersion instead of latest")
    .description("Print inputs, outputs, steps, and success for humans")
    .action(async (id: string, opts: { version?: string }) => {
      const registry = resolveRegistry();
      const artifact =
        opts.version === undefined
          ? await registry.get(id)
          : await registry.get(id, opts.version);
      if (artifact === undefined) {
        writeErr(`capability "${id}" is not in the catalog`);
        process.exitCode = 1;
        return;
      }
      write(formatCapabilityDescription(artifact));
    });

  program
    .command("run")
    .argument("<id>", "Capability id")
    // `--loanAccountId value` is not a declared option; Commander treats it as extra
    // positionals. Capture them here so typed inputs stay on the CLI, not in JSON.
    .argument("[tokens...]", "Typed --name value inputs")
    .requiredOption("--url <url>", "Surface entry URL (not tenant identity)")
    .option("--tenant <tenant>", "Enrolled tenant id", DEFAULT_ICAS_IDENTITY)
    .option("--vendor <vendor>", "Vendor identity", DEFAULT_ICAS_IDENTITY)
    .option("--product <product>", "Product identity", DEFAULT_ICAS_IDENTITY)
    .option("--version <semver>", "Pin a capabilityVersion instead of latest")
    .option("--input <name=value>", "Typed capability input (repeatable)", collectInput, [])
    .option("--headless", "Launch Chromium without a window")
    .option("--assist", "One bounded LLM repair at a failed step (default is model-free)")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Deterministic replay of an enrolled tenant (model-free unless --assist)")
    .action(async (id: string, tokens: string[], opts: RunCommandOptions) => {
      await executeRunCommand(id, tokens, opts, {
        registry: resolveRegistry(),
        write,
        writeErr,
        env: deps.env ?? process.env,
        ...(deps.executeReplay === undefined
          ? {}
          : { executeReplay: deps.executeReplay }),
        ...(deps.repair === undefined ? {} : { repair: deps.repair }),
      });
    });

  return program;
}

interface RunCommandOptions {
  url: string;
  tenant: string;
  vendor: string;
  product: string;
  version?: string;
  input: string[];
  headless?: boolean;
  assist?: boolean;
}

/**
 * Parse typed inputs, resolve enrollment, then replay.
 *
 * @param id - Capability id from the positional argument
 * @param tokens - Leftover `--loanAccountId value` flags Commander did not declare
 * @param opts - Commander-parsed reserved flags
 */
async function executeRunCommand(
  id: string,
  tokens: string[],
  opts: RunCommandOptions,
  io: {
    registry: CapabilityRegistry;
    write: (line: string) => void;
    writeErr: (line: string) => void;
    executeReplay?: (invocation: PlayReplayInvocation) => Promise<ExecutionResult>;
    repair?: RepairProposer;
    env: NodeJS.ProcessEnv;
  },
): Promise<void> {
  try {
    const fromRepeatable = parseCapabilityInputFlags(
      opts.input.map((pair) => `--input=${pair}`),
    );
    const fromUnknown = parseCapabilityInputFlags(tokens);
    const rawInputs = { ...fromRepeatable, ...fromUnknown };
    const registry = io.registry;
    const preview =
      opts.version === undefined
        ? await registry.get(id)
        : await registry.get(id, opts.version);
    if (preview === undefined) {
      throw new CapabilityResolveError(`capability "${id}" is not in the catalog`);
    }
    const inputs = coerceInputValues(preview.inputs, rawInputs);
    const request: PlayRunRequest = {
      id,
      url: opts.url,
      tenant: opts.tenant,
      vendor: opts.vendor,
      product: opts.product,
      inputs,
      assist: opts.assist === true,
      headed: resolveHeaded(opts.headless === true, io.env),
      ...(opts.version === undefined ? {} : { version: opts.version }),
    };
    const result = await runEnrolledReplay(request, {
      registry,
      env: io.env,
      ...(io.executeReplay === undefined ? {} : { executeReplay: io.executeReplay }),
      ...(io.repair === undefined ? {} : { repair: io.repair }),
    });
    io.write(formatRunResult(result));
    process.exitCode = exitCodeForResult(result);
  } catch (error) {
    io.writeErr(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * Headed is the production default so HITL can take the same window.
 *
 * `--headless`, `ICAS_HEADLESS=1`, and CI force a headless launch.
 *
 * @param headlessFlag - Commander `--headless`
 * @param env - Process env
 */
function resolveHeaded(headlessFlag: boolean, env: NodeJS.ProcessEnv): boolean {
  if (headlessFlag) {
    return false;
  }
  if (env.ICAS_HEADLESS === "1" || env.CI === "true") {
    return false;
  }
  return true;
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
  const writeErr = deps.stderr ?? ((line: string) => {
    console.error(line);
  });
  try {
    await createPlayProgram(deps).parseAsync(argv);
  } catch (error) {
    // exitOverride turns `--help` and missing `--url` into thrown CommanderError.
    if (error instanceof CommanderError) {
      if (error.code !== "commander.helpDisplayed") {
        writeErr(error.message);
      }
      process.exitCode = error.exitCode === 0 ? 0 : 1;
      return;
    }
    if (error instanceof CapabilityResolveError || error instanceof CapabilityTypeError) {
      writeErr(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (isMain) {
  // pnpm --filter exec strips OPENAI_API_KEY; `--assist` still needs a key.
  loadRepoEnv();
  void runPlay().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
