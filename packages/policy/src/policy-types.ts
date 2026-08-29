/**
 * @file Policy types — runtime allowlist contract.
 */

import type { CapabilityAction } from "@icas/capability";

/**
 * Runtime execution policy. Prompt markdown is not a substitute for this.
 */
export interface RuntimePolicy {
  allowedOrigins: string[];
  allowedActionTypes: CapabilityAction["type"][];
  approvalRequiredForRisk?: Array<"risky">;
}

/**
 * Outcome of {@link PolicyGuard.check}.
 */
export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "require-human"; reason: string };

/**
 * Navigation context for origin checks (known href before click, URL after).
 */
export interface PolicyCheckContext {
  currentUrl?: string;
  destinationUrl?: string;
  resultingUrl?: string;
}
