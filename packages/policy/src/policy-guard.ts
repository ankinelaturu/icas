/**
 * @file PolicyGuard — runtime allowlist before any Surface.execute.
 */

import type { CapabilityAction } from "@icas/capability";

import type {
  PolicyCheckContext,
  PolicyDecision,
  RuntimePolicy,
} from "./policy-types.js";

/**
 * Enforce what the system will execute. Prompt policy is not a substitute.
 */
export class PolicyGuard {
  constructor(private readonly policy: RuntimePolicy) {}

  /**
   * Decide whether `action` may run in `context`.
   */
  check(action: CapabilityAction, context: PolicyCheckContext = {}): PolicyDecision {
    if (!this.policy.allowedActionTypes.includes(action.type)) {
      return {
        decision: "deny",
        reason: `Action type ${action.type} is not allowed.`,
      };
    }
    if ("risk" in action && action.risk === "risky") {
      const required = this.policy.approvalRequiredForRisk ?? ["risky"];
      if (required.includes("risky")) {
        return {
          decision: "require-human",
          reason: "Risky action requires human approval.",
        };
      }
    }
    const originDenial = this.denyIfOriginNotAllowed(context.destinationUrl)
      ?? this.denyIfOriginNotAllowed(context.resultingUrl);
    if (originDenial !== undefined) {
      return originDenial;
    }
    return { decision: "allow" };
  }

  private denyIfOriginNotAllowed(url: string | undefined): PolicyDecision | undefined {
    if (url === undefined || url.length === 0) {
      return undefined;
    }
    const origin = new URL(url).origin;
    if (!this.policy.allowedOrigins.includes(origin)) {
      return { decision: "deny", reason: `Origin ${origin} is not allowed.` };
    }
    return undefined;
  }
}
