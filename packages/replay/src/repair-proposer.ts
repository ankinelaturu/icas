/**
 * @file repair-proposer — one bounded LLM repair for a failed replay step.
 *
 * Assisted fallback is not open-ended rediscovery. The proposer sees one
 * frozen failure context and returns replacement actions for that step only.
 * ReplayEngine still policy-checks, budgets, and requires path rejoin.
 */

import type {
  CapabilityAction,
  CapabilityArtifact,
  CapabilityStep,
} from "@icas/capability";
import type { Observation } from "@icas/surface";

import type { ExecutionResult } from "./execution-result.js";

/**
 * Frozen context handed to a repair proposer when `--assist` is on.
 *
 * `capability` is the already-resolved effective artifact. The proposer must
 * not look up tenants or catalog paths.
 */
export interface RepairContext {
  step: CapabilityStep;
  capability: CapabilityArtifact;
  failure: Extract<ExecutionResult, { status: "failure" }>;
  observation: Observation;
}

/**
 * Replacement actions for a single failed step. Not open-ended rediscovery.
 *
 * `rationale` is recorded in evidence so operators can see why the
 * non-deterministic path ran.
 */
export interface RepairProposal {
  actions: CapabilityAction[];
  rationale: string;
}

/**
 * Ask a model (or test fake) for a bounded repair.
 *
 * Production injects a Mastra-backed implementation. Tests inject a stub so
 * ReplayEngine assist paths stay deterministic.
 */
export interface RepairProposer {
  /**
   * Return replacement actions for `context.step` only.
   */
  propose(context: RepairContext): Promise<RepairProposal>;
}
