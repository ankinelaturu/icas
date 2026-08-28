import type { CapabilityArtifact, CapabilityStep } from "@icas/capability";
import type { Surface } from "@icas/surface";

export type ExecutionResult =
  | { status: "success"; capabilityId: string; outputs: Record<string, unknown>; runId: string }
  | { status: "business_outcome"; capabilityId: string; outcome: string; details?: unknown; runId: string }
  | { status: "failure"; capabilityId: string; code: string; stepId?: string; expected?: unknown; observed?: unknown; runId: string };

export interface ReplayOptions {
  assist?: boolean;
  maxRetries?: number;
}

export class ReplayEngine {
  constructor(private readonly surface: Surface) {}

  async run(
    _capability: CapabilityArtifact,
    _inputs: Record<string, unknown>,
    _options: ReplayOptions = {},
  ): Promise<ExecutionResult> {
    throw new Error("ReplayEngine.run is a scaffold.");
  }

  async verifyStep(_step: CapabilityStep): Promise<void> {
    throw new Error("ReplayEngine.verifyStep is a scaffold.");
  }
}
