/**
 * @file CapabilityCompiler — trace → artifact. Scaffold until later passes.
 */

import type { CapabilityArtifact } from "@icas/capability";

export class CapabilityCompiler {
  async compile(_tracePath: string): Promise<CapabilityArtifact> {
    throw new Error("CapabilityCompiler.compile is a scaffold.");
  }
}
