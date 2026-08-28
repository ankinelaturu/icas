export type ControlOwner = "automation" | "human";

export type InterventionReason =
  | "approval_required"
  | "discovery_stuck"
  | "unexpected_state"
  | "policy_block"
  | "hard_failure_recovery";

export interface InterventionRequest {
  runId: string;
  reason: InterventionReason;
  message: string;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  observationRef?: string;
}

export interface HandoffController {
  owner(): ControlOwner;
  request(intervention: InterventionRequest): Promise<void>;
  waitForResume(): Promise<void>;
}
