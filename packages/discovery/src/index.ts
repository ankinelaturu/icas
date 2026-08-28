import type { CapabilityArtifact } from "@icas/capability";
import type { Surface } from "@icas/surface";

export interface DiscoveryTarget {
  vendor: string;
  product: string;
  tenant: string;
  url: string;
}

export interface DiscoveryRequest {
  target: DiscoveryTarget;
  goal: string;
  maxSteps?: number;
  maxDepth?: number;
  maxCandidatesPerState?: number;
  timeoutMs?: number;
}

export interface DiscoveryResult {
  status: "success" | "stuck" | "failed";
  capability?: CapabilityArtifact;
  runId: string;
  reason?: string;
}

export class DiscoveryAgent {
  constructor(private readonly surface: Surface) {}

  async run(_request: DiscoveryRequest): Promise<DiscoveryResult> {
    throw new Error("DiscoveryAgent.run is a scaffold. Implement Mastra + bounded UI search here.");
  }
}

export class CapabilityCompiler {
  async compile(_tracePath: string): Promise<CapabilityArtifact> {
    throw new Error("CapabilityCompiler.compile is a scaffold.");
  }
}
