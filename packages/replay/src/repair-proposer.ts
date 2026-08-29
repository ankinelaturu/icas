/**
 * @file repair-proposer — one bounded LLM repair for a failed replay step.
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
 */
export interface RepairContext {
  step: CapabilityStep;
  capability: CapabilityArtifact;
  failure: Extract<ExecutionResult, { status: "failure" }>;
  observation: Observation;
}

/**
 * Replacement actions for a single failed step. Not open-ended rediscovery.
 */
export interface RepairProposal {
  actions: CapabilityAction[];
  rationale: string;
}

/**
 * Ask a model (or test fake) for a bounded repair.
 */
export interface RepairProposer {
  propose(context: RepairContext): Promise<RepairProposal>;
}
