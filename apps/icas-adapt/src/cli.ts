#!/usr/bin/env node
/**
 * @file icas-adapt — cross-tenant specialization CLI.
 *
 * Guarded replay of a Vendor+Product base against a new tenant URL.
 * `--tenant` is required; do not default it to `icas-bank`. `--url` is only
 * the surface entry. After guarded replay this pass writes a header-only
 * override (`verified`) or a one-step patch (`icas-adapt`).
 *
 * Mismatch patches call Mastra once via StepSpecializer (`ICAS_ADAPT_LLM_*`).
 * Compatible runs skip the model. ReplayEngine stays model-free. The CLI
 * prints system instructions, the exact generate message, and the structured
 * model object (never the API key).
 *
 * @see docs/06-multi-tenant-and-adaptation.md
 */

import { Command, CommanderError } from "commander";

import {
  FileSystemCapabilityRegistry,
  type CapabilityRegistry,
} from "@icas/capability";
import { isIcasLlmReady, resolveIcasLlmSettings } from "@icas/discovery";
import type { ExecutionResult } from "@icas/replay";

import { runGuardedAdapt, type AdaptReplayInvocation, type AdaptRunRequest } from "./adapt-session.js";
import type { StepSpecializer } from "./build-override.js";
import { catalogRoot } from "./catalog-root.js";
import { coerceInputValues } from "./coerce-inputs.js";
import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import { evidenceRoot } from "./evidence-root.js";
import { formatAdaptOutcome } from "./format-adapt-log.js";
import { loadRepoEnv } from "./load-repo-env.js";
import { createConfiguredStepSpecializer } from "./mastra-step-specializer.js";
import { parseCapabilityInputFlags } from "./parse-cli-inputs.js";

export interface AdaptCliDeps {
  registry?: CapabilityRegistry;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  executeReplay?: (invocation: AdaptReplayInvocation) => Promise<ExecutionResult>;
  specializer?: StepSpecializer;
  /** Stubbed visible chrome for tests; live Playwright capture ignores this. */
  pageText?: string;
  env?: NodeJS.ProcessEnv;
}

function collectInput(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createAdaptProgram(deps: AdaptCliDeps = {}): Command {
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
    .name("icas-adapt")
    .description("Guarded replay of a Vendor+Product capability against a new tenant")
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
    .argument("<id>", "Capability id")
    .argument("[tokens...]", "Typed --name value inputs")
    .requiredOption("--tenant <tenant>", "Tenant to specialize (required; not defaulted)")
    .requiredOption("--url <url>", "Surface entry URL (not tenant identity)")
    .option("--vendor <vendor>", "Vendor identity", DEFAULT_ICAS_IDENTITY)
    .option("--product <product>", "Product identity", DEFAULT_ICAS_IDENTITY)
    .option("--input <name=value>", "Typed capability input (repeatable)", collectInput, [])
    .option("--headless", "Launch Chromium without a window")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (id: string, tokens: string[], opts: AdaptCommandOptions) => {
      await executeAdaptCommand(id, tokens, opts, {
        registry: resolveRegistry(),
        write,
        writeErr,
        env: deps.env ?? process.env,
        ...(deps.executeReplay === undefined ? {} : { executeReplay: deps.executeReplay }),
        ...(deps.specializer === undefined ? {} : { specializer: deps.specializer }),
        ...(deps.pageText === undefined ? {} : { pageText: deps.pageText }),
      });
    });

  return program;
}

interface AdaptCommandOptions {
  tenant: string;
  url: string;
  vendor: string;
  product: string;
  input: string[];
  headless?: boolean;
}

async function executeAdaptCommand(
  id: string,
  tokens: string[],
  opts: AdaptCommandOptions,
  io: {
    registry: CapabilityRegistry;
    write: (line: string) => void;
    writeErr: (line: string) => void;
    executeReplay?: (invocation: AdaptReplayInvocation) => Promise<ExecutionResult>;
    specializer?: StepSpecializer;
    pageText?: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<void> {
  try {
    const fromRepeatable = parseCapabilityInputFlags(
      opts.input.map((pair) => `--input=${pair}`),
    );
    const fromUnknown = parseCapabilityInputFlags(tokens);
    const raw = { ...fromRepeatable, ...fromUnknown };
    const preview = await io.registry.get(id);
    if (preview === undefined) {
      throw new Error(`capability "${id}" is not in the catalog`);
    }
    const request: AdaptRunRequest = {
      id,
      url: opts.url,
      tenant: opts.tenant,
      vendor: opts.vendor,
      product: opts.product,
      inputs: coerceInputValues(preview.inputs, raw),
      headed: resolveHeaded(opts.headless === true, io.env),
    };
    io.write(`catalog: ${catalogRoot(io.env)}`);
    io.write(`evidence root: ${evidenceRoot(io.env)}`);
    io.write(`vendor/product: ${request.vendor}/${request.product}`);
    io.write(`headed: ${String(request.headed)}`);
    io.write(`inputs: ${JSON.stringify(request.inputs, null, 2)}`);
    const specializer = await resolveAdaptSpecializer(io);
    const { report, override, reverify } = await runGuardedAdapt(request, {
      registry: io.registry,
      log: io.write,
      ...(io.executeReplay === undefined ? {} : { executeReplay: io.executeReplay }),
      ...(specializer === undefined ? {} : { specializer }),
      ...(io.pageText === undefined ? {} : { pageText: io.pageText }),
    });
    io.write(
      formatAdaptOutcome({
        tenant: opts.tenant,
        report,
        ...(override === undefined ? {} : { override }),
        ...(reverify === undefined ? {} : { reverify }),
      }),
    );
    process.exitCode = 0;
  } catch (error) {
    io.writeErr(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

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
 * Prefer an injected stub (tests). Otherwise construct Mastra when
 * `ICAS_ADAPT_LLM_*` is ready. Compatible runs still skip `specialize`.
 *
 * @param io - CLI I/O plus optional stub specializer
 * @returns Specializer, or `undefined` so mismatch fails closed with env hint
 */
async function resolveAdaptSpecializer(io: {
  specializer?: StepSpecializer;
  env: NodeJS.ProcessEnv;
  write: (line: string) => void;
}): Promise<StepSpecializer | undefined> {
  if (io.specializer !== undefined) {
    io.write("specializer: injected");
    return io.specializer;
  }
  if (!isIcasLlmReady(resolveIcasLlmSettings("adapt", io.env))) {
    io.write(
      "specializer: unset (compatible enrollments skip the model; mismatch needs ICAS_ADAPT_LLM_*)",
    );
    return undefined;
  }
  const configured = await createConfiguredStepSpecializer({
    env: io.env,
    log: io.write,
  });
  io.write(`specializer: ready model=${configured.model}`);
  return configured.specializer;
}

/**
 * Drop the `--` pnpm inserts between the script path and forwarded CLI args.
 *
 * Root scripts run `pnpm --filter @icas/adapt start --`. pnpm then invokes
 * `tsx src/cli.ts -- loan-payoff --tenant …`. Node argv is
 * `[node, cli.ts, '--', 'loan-payoff', '--tenant', …]`. Commander treats
 * `--` as end-of-options, so `--tenant` is no longer a flag. Tests pass
 * argv without this token; leave those slices unchanged.
 *
 * @param argv - Process argv including node and script
 * @returns Argv Commander can parse as flags
 */
export function argvWithoutPnpmTerminator(argv: string[]): string[] {
  // Only the pnpm-injected terminator sits immediately after the script path.
  if (argv[2] === "--") {
    return [argv[0]!, argv[1]!, ...argv.slice(3)];
  }
  return argv;
}

/**
 * Parse argv and run guarded adapt.
 *
 * @param argv - Process argv including node and script, or a test slice
 */
export async function runAdapt(
  argv: string[] = process.argv,
  deps: AdaptCliDeps = {},
): Promise<void> {
  const writeErr = deps.stderr ?? ((line: string) => {
    console.error(line);
  });
  try {
    await createAdaptProgram(deps).parseAsync(argvWithoutPnpmTerminator(argv));
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code !== "commander.helpDisplayed") {
        writeErr(error.message);
      }
      process.exitCode = error.exitCode === 0 ? 0 : 1;
      return;
    }
    throw error;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (isMain) {
  // pnpm --filter exec strips ICAS_*_LLM_API_KEY; adapt still needs a key.
  loadRepoEnv();
  void runAdapt().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
