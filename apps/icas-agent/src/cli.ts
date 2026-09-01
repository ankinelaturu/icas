#!/usr/bin/env node
/**
 * @file icas-agent — goal-driven discovery CLI.
 *
 * Always discovers. Does not silently replay a stored capability, infer
 * identity from `--url`, or author catalog JSON by hand. `--id` names the
 * Vendor+Product capability; a later institution uses `icas-adapt`.
 * On process start, empty model keys are filled from repo-root `.env`.
 *
 * @see docs/01-system-overview.md
 * @see docs/03-discovery-agent.md
 */

import { Command, CommanderError } from "commander";

import {
  FileSystemCapabilityRegistry,
  type CapabilityRegistry,
} from "@icas/capability";
import type { CandidateProposer, DiscoveryRequest, DiscoveryResult } from "@icas/discovery";

import { catalogRoot } from "./catalog-root.js";
import { DEFAULT_ICAS_IDENTITY } from "./defaults.js";
import {
  runDiscover,
  type DiscoverRequest,
} from "./discover-session.js";
import { loadRepoEnv } from "./load-repo-env.js";

/**
 * Injectable IO so tests never touch repo `capabilities/` or Chromium.
 */
export interface AgentCliDeps {
  registry?: CapabilityRegistry;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  runDiscovery?: (request: DiscoveryRequest) => Promise<DiscoveryResult>;
  proposer?: CandidateProposer;
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the Commander program.
 */
export function createAgentProgram(deps: AgentCliDeps = {}): Command {
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
    .name("icas-agent")
    .description("Goal-driven discovery; never silently replays a stored capability")
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
    .command("discover")
    .description("Discover a capability from a live surface and persist it")
    .requiredOption("--id <id>", "Unique catalog id")
    .requiredOption("--url <url>", "Surface entry URL (not tenant identity)")
    .requiredOption("--goal <goal>", "Natural-language goal")
    .option("--tenant <tenant>", "Discovering tenant", DEFAULT_ICAS_IDENTITY)
    .option("--vendor <vendor>", "Vendor identity", DEFAULT_ICAS_IDENTITY)
    .option("--product <product>", "Product identity", DEFAULT_ICAS_IDENTITY)
    .option("--name <name>", "Human-readable capability name")
    .option("--headless", "Launch Chromium without a window")
    .action(async (opts: DiscoverCommandOptions) => {
      await executeDiscoverCommand(opts, {
        registry: resolveRegistry(),
        write,
        writeErr,
        env: deps.env ?? process.env,
        ...(deps.runDiscovery === undefined ? {} : { runDiscovery: deps.runDiscovery }),
        ...(deps.proposer === undefined ? {} : { proposer: deps.proposer }),
      });
    });

  return program;
}

interface DiscoverCommandOptions {
  id: string;
  url: string;
  goal: string;
  tenant: string;
  vendor: string;
  product: string;
  name?: string;
  headless?: boolean;
}

/**
 * Parse flags, refuse an existing id, then discover.
 */
async function executeDiscoverCommand(
  opts: DiscoverCommandOptions,
  io: {
    registry: CapabilityRegistry;
    write: (line: string) => void;
    writeErr: (line: string) => void;
    runDiscovery?: (request: DiscoveryRequest) => Promise<DiscoveryResult>;
    proposer?: CandidateProposer;
    env: NodeJS.ProcessEnv;
  },
): Promise<void> {
  try {
    const request: DiscoverRequest = {
      id: opts.id,
      url: opts.url,
      goal: opts.goal,
      tenant: opts.tenant,
      vendor: opts.vendor,
      product: opts.product,
      headed: resolveHeaded(opts.headless === true, io.env),
      ...(opts.name === undefined ? {} : { name: opts.name }),
    };
    const { artifact, result } = await runDiscover(request, {
      registry: io.registry,
      env: io.env,
      log: io.writeErr,
      ...(io.runDiscovery === undefined ? {} : { runDiscovery: io.runDiscovery }),
      ...(io.proposer === undefined ? {} : { proposer: io.proposer }),
    });
    io.write(`status: ${result.status}`);
    io.write(`id: ${artifact.id}`);
    io.write(`runId: ${result.runId}`);
    io.write(`enrolled tenant: ${opts.tenant} (header-only override)`);
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
 * Parse argv and run the selected subcommand.
 *
 * @param argv - Process argv including node and script, or a test slice
 */
export async function runAgent(
  argv: string[] = process.argv,
  deps: AgentCliDeps = {},
): Promise<void> {
  const writeErr = deps.stderr ?? ((line: string) => {
    console.error(line);
  });
  try {
    await createAgentProgram(deps).parseAsync(argv);
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
  // pnpm --filter exec strips ICAS_*_LLM_API_KEY; fill empty keys from repo `.env`.
  loadRepoEnv();
  void runAgent().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
