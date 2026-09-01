/**
 * @file Test capability builders for ReplayEngine.
 */

import type { CapabilityArtifact, CapabilityStep } from "@icas/capability";

/**
 * Minimal effective capability. Empty `steps` is valid for engine tests even
 * though catalog validation requires at least one step.
 */
export function testCapability(
  overrides: Partial<CapabilityArtifact> = {},
): CapabilityArtifact {
  return {
    schemaVersion: "1.0",
    id: "loan-payoff",
    name: "Test capability",
    target: { vendor: "icas-bank", product: "icas-bank" },
    inputs: {},
    outputs: {},
    steps: [],
    success: [{ type: "textVisible", value: "Payoff Statement" }],
    ...overrides,
  };
}

/**
 * One click step with optional checkpoints.
 */
export function clickStep(
  id: string,
  extras: Partial<CapabilityStep> = {},
): CapabilityStep {
  return {
    id,
    preconditions: [],
    action: {
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Continue" }] },
      risk: "safe",
    },
    postconditions: [],
    ...extras,
  };
}
