/**
 * @file Handoff types — HITL ownership and intervention contract.
 */

/**
 * Who currently issues actions on the live session.
 */
export type ControlOwner = "automation" | "human";

/**
 * Why automation paused for a human.
 */
export type InterventionReason =
  | "approval_required"
  | "discovery_stuck"
  | "unexpected_state"
  | "policy_block"
  | "hard_failure_recovery";

/**
 * Context an operator needs to act without reconstructing the run.
 */
export interface InterventionRequest {
  runId: string;
  reason: InterventionReason;
  message: string;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  observationRef?: string;
}

/**
 * Pause automation, wait for a human, then return control.
 */
export interface HandoffController {
  owner(): ControlOwner;
  request(intervention: InterventionRequest): Promise<void>;
  waitForResume(): Promise<void>;
}

export const INTERVENTION_REASONS: readonly InterventionReason[] = [
  "approval_required",
  "discovery_stuck",
  "unexpected_state",
  "policy_block",
  "hard_failure_recovery",
];
