/**
 * @file Handoff types — HITL ownership and intervention contract.
 *
 * Handoff means automation → human on the same live session, then an explicit
 * resume. It is not a yes/no prompt alone and not a co-browsing console.
 *
 * @see SessionHandoffController
 * @see docs/07-human-handoff.md
 */

/**
 * Who currently issues actions on the live session.
 *
 * While `"human"`, Surface.execute must not run. CLI questions do not by
 * themselves flip this; browser takeover does.
 */
export type ControlOwner = "automation" | "human";

/**
 * Why automation paused for a human.
 *
 * Distinguishes policy-required approval from exceptional recovery so those
 * recoveries are not compiled into the reusable capability path.
 */
export type InterventionReason =
  | "approval_required"
  | "discovery_stuck"
  | "unexpected_state"
  | "policy_block"
  | "hard_failure_recovery";

/**
 * Context an operator needs to act without reconstructing the run.
 *
 * `runId` ties the pause to evidence. Optional fields locate the step when
 * the operator has only the headed window and this message.
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
 *
 * Implementations stay in-process. The important seam is ownership, not an
 * operator UI.
 */
export interface HandoffController {
  owner(): ControlOwner;
  request(intervention: InterventionRequest): Promise<void>;
  waitForResume(): Promise<void>;
}

/**
 * Runtime list matching {@link InterventionReason}.
 *
 * Used by {@link validateInterventionRequest} so a typo cannot become evidence.
 */
export const INTERVENTION_REASONS: readonly InterventionReason[] = [
  "approval_required",
  "discovery_stuck",
  "unexpected_state",
  "policy_block",
  "hard_failure_recovery",
];
