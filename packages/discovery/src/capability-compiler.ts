/**
 * @file CapabilityCompiler — trace → base artifact plus optional catalog persist.
 *
 * Failed exploration stays in the JSONL evidence. Checkpoints and
 * Vendor+Product identity come from the success-path stack. Outputs and
 * `success` prefer the proposer’s success-event `result`, reduced when
 * `textVisible` values embed dates, amounts, or confirmation ids. Older traces
 * fall back to `read` steps and last-step URL. The compiler reconstructs the
 * path as a stack: ok `chosen_action` pushes, `backtrack` pops.
 */

import { readFile } from "node:fs/promises";

import type {
  CapabilityArtifact,
  CapabilityRegistry,
  CapabilityStep,
  PossibleOutcome,
} from "@icas/capability";

import {
  deriveCheckpoints,
  deriveOutputs,
  durableSuccessSignals,
  artifactOutputsFromResult,
  semanticAction,
  uniqueStepId,
} from "./derive-artifact.js";
import type { DiscoveryTraceEvent } from "./discovery-types.js";
import {
  extractDiscoverySuccessResult,
  extractSuccessfulPath,
  type SuccessfulPathStep,
} from "./extract-successful-path.js";
import {
  inputsFromHints,
  parameterizeAction,
} from "./parameterize-inputs.js";

/**
 * Compile inputs. Provide in-memory `events` or a JSONL `tracePath`.
 * `registry` is optional so tests can compile without writing the catalog.
 */
export interface CompileRequest {
  /** Unique catalog id, e.g. `loan-payoff`. */
  id: string;
  target: {
    vendor: string;
    product: string;
    /** Discovering tenant; written to `discoveredOn` and the header-only override. */
    tenant?: string;
    url?: string;
  };
  /** In-memory trace from {@link DiscoveryAgent}. */
  events?: DiscoveryTraceEvent[];
  /** Append-only JSONL on disk (one event object per line). */
  tracePath?: string;
  name?: string;
  /** When set, `save` the base artifact and a header-only tenant override. */
  registry?: CapabilityRegistry;
  /** Provenance pointer stored on the tenant override as `createdFromRun`. */
  runId?: string;
}

/**
 * Compile a capability from a discovery trace. Only the success-path stack
 * becomes `steps`; dead-ends remain evidence.
 */
export class CapabilityCompiler {
  /**
   * Build a base artifact from the reconstructed success path.
   *
   * @param request - Identity, trace source, optional persist registry
   * @returns Schema-shaped artifact (not yet replayed)
   * @throws {Error} When the trace has no executable success path
   * @throws {ParameterizeError} When fill/select cannot be named from proposer hints
   */
  async compile(request: CompileRequest): Promise<CapabilityArtifact> {
    const events = await loadTraceEvents(request);
    const path = extractSuccessfulPath(events);
    if (path.length === 0) {
      // Empty stack means every branch backtracked or no ok execute occurred.
      throw new Error("CapabilityCompiler: trace has no successful executable path");
    }
    // Aggregate names before rewriting so literal clash detection still sees
    // discovery-time values.
    const inputs = inputsFromHints(path);
    const usedIds = new Set<string>();
    const steps: CapabilityStep[] = [];
    for (const [index, step] of path.entries()) {
      // Recurring approval is a separate handoff step before the action.
      // Skip when the action is already a handoff so we do not duplicate it.
      if (step.insertHandoff !== undefined && step.action.type !== "handoff") {
        const handoff = {
          type: "handoff" as const,
          reason: step.insertHandoff,
        };
        steps.push({
          id: uniqueStepId(handoff, index, usedIds),
          preconditions: [],
          action: handoff,
          postconditions: [],
        });
      }
      steps.push(toStep(step, path[index - 1], index, usedIds));
    }
    // Prefer the success-turn contract. Missing/invalid payload is an old
    // trace: harvest from `read` steps and last-step chrome instead.
    const declared = extractDiscoverySuccessResult(events);
    const artifact: CapabilityArtifact = {
      schemaVersion: "1.0",
      id: request.id,
      name: request.name ?? request.id,
      target: {
        // Base identity is Vendor+Product. Tenant belongs on the override, not here.
        vendor: request.target.vendor,
        product: request.target.product,
      },
      ...(request.target.tenant === undefined
        ? {}
        : { discoveredOn: { tenant: request.target.tenant } }),
      inputs,
      outputs:
        declared === undefined
          ? deriveOutputs(steps)
          : artifactOutputsFromResult(declared.outputs),
      steps,
      success: durableSuccessSignals(
        declared === undefined ? [] : declared.successSignals,
        path,
      ),
    };
    if (request.registry !== undefined) {
      await persistDiscoveredCapability(request.registry, artifact, {
        ...(request.target.tenant === undefined ? {} : { tenant: request.target.tenant }),
        ...(request.runId === undefined ? {} : { runId: request.runId }),
      });
    }
    return artifact;
  }
}

/**
 * Save the base artifact and enroll the discovering tenant with `overrides: {}`.
 *
 * Refuse an existing `id` so discover cannot clobber a catalog entry.
 * Header-only enrollment is required: `icas-play` / MCP fail if the tenant
 * is not enrolled.
 *
 * @param registry - Catalog backend (filesystem in this repo)
 * @param artifact - Newly compiled base capability
 * @param options.tenant - When set, write a header-only override for that tenant
 * @param options.runId - Provenance pointer back to the discovery run
 * @throws {Error} When `id` is already stored
 */
export async function persistDiscoveredCapability(
  registry: CapabilityRegistry,
  artifact: CapabilityArtifact,
  options: { tenant?: string; runId?: string },
): Promise<void> {
  const existing = await registry.get(artifact.id);
  if (existing !== undefined) {
    throw new Error(
      `capability "${artifact.id}" already exists; choose a new --id`,
    );
  }
  await registry.save(artifact);
  if (options.tenant === undefined) {
    // Compile without enrollment when the caller omitted tenant (tests, dry compile).
    return;
  }
  await registry.saveOverride({
    schemaVersion: "1.0",
    id: `${artifact.id}-${options.tenant}`,
    baseCapability: artifact.id,
    target: { tenant: options.tenant },
    overrides: {},
    provenance: {
      createdBy: "discovery",
      reason: "enrolled discovering tenant",
      ...(options.runId === undefined ? {} : { createdFromRun: options.runId }),
    },
  });
}

/**
 * Prefer in-memory events (agent just finished). Else parse JSONL from disk.
 *
 * @param request - Exactly one of `events` or `tracePath` must be present
 * @returns Events in append order
 * @throws {Error} When neither source is provided
 */
export async function loadTraceEvents(
  request: Pick<CompileRequest, "events" | "tracePath">,
): Promise<DiscoveryTraceEvent[]> {
  if (request.events !== undefined) {
    return request.events;
  }
  if (request.tracePath === undefined) {
    throw new Error("CapabilityCompiler: provide events or tracePath");
  }
  const text = await readFile(request.tracePath, "utf8");
  // One JSON object per line, as {@link DiscoveryTrace} wrote them.
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DiscoveryTraceEvent);
}

/**
 * Parameterize literals, drop coordinate locators when a semantic strategy
 * exists, then derive checkpoints from this step and the previous one.
 */
function toStep(
  step: SuccessfulPathStep,
  previous: SuccessfulPathStep | undefined,
  index: number,
  usedIds: Set<string>,
): CapabilityStep {
  const action = semanticAction(parameterizeAction(step.action, step.proposedInputParam));
  const { preconditions, postconditions } = deriveCheckpoints(step, previous);
  return {
    id: uniqueStepId(action, index, usedIds),
    preconditions,
    action,
    postconditions,
    possibleOutcomes: compiledPossibleOutcomes(step.possibleOutcomes),
  };
}

/**
 * Keep error and hitl guesses in proposer order. Drop `success`: the next
 * step's locator is how replay knows the happy path continued. Missing or
 * empty stays `[]` so replay can walk the field without inventing from DFS.
 */
function compiledPossibleOutcomes(
  outcomes: readonly PossibleOutcome[] | undefined,
): PossibleOutcome[] {
  if (outcomes === undefined) {
    return [];
  }
  return outcomes.filter(
    (outcome) => outcome.kind === "error" || outcome.kind === "hitl",
  );
}
