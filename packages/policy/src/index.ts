/**
 * @file @icas/policy — prompt-policy loading and runtime PolicyGuard.
 */

import type { CapabilityAction } from "@icas/capability";

export interface RuntimePolicy {
  allowedOrigins: string[];
  allowedActionTypes: CapabilityAction["type"][];
  approvalRequiredForRisk?: Array<"risky">;
}

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "require-human"; reason: string };

/**
 * Runtime allowlist. Prompt text is not enforcement.
 */
export class PolicyGuard {
  constructor(private readonly policy: RuntimePolicy) {}

  check(
    action: CapabilityAction,
    context: { currentUrl?: string; destinationUrl?: string },
  ): PolicyDecision {
    if (!this.policy.allowedActionTypes.includes(action.type)) {
      return { decision: "deny", reason: `Action type ${action.type} is not allowed.` };
    }
    if ("risk" in action && action.risk === "risky") {
      return { decision: "require-human", reason: "Risky action requires human approval." };
    }
    if (context.destinationUrl !== undefined && context.destinationUrl.length > 0) {
      const origin = new URL(context.destinationUrl).origin;
      if (!this.policy.allowedOrigins.includes(origin)) {
        return { decision: "deny", reason: `Origin ${origin} is not allowed.` };
      }
    }
    return { decision: "allow" };
  }
}

export {
  defaultPromptPolicyPath,
  loadPromptPolicy,
  resolvePromptPolicyPath,
} from "./load-prompt-policy.js";
