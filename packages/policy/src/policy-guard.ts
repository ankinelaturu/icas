/**
 * @file PolicyGuard — runtime allow / deny / require-human before Surface.execute.
 *
 * Prompt markdown is advice to the model. This class is the enforcement seam:
 * a recorded capability cannot bypass it, and a proposer cannot self-authorize.
 *
 * @see RuntimePolicy
 * @see PolicyDecision
 */

import type { CapabilityAction } from "@icas/capability";

import { dangerousActionReason } from "./action-text.js";
import type {
  PolicyCheckContext,
  PolicyDecision,
  RuntimePolicy,
} from "./policy-types.js";

/**
 * Enforce what the system will execute. Prompt policy is not a substitute.
 *
 * Callers must invoke {@link check} on every proposed or replayed action.
 * `deny` stops the step. `require-human` transfers the same headed session
 * (HITL), never a second browser.
 */
export class PolicyGuard {
  constructor(private readonly policy: RuntimePolicy) {}

  /**
   * Decide whether `action` may run in `context`.
   *
   * Order is fail-closed then escalate: unknown types and dangerous control
   * text are denied before a `risky` tag can ask for a human. Origin checks
   * run last because they need URLs the surface may only know after peek/nav.
   *
   * @param action - Proposed or recorded step; model `risk` is not trusted alone
   * @param context - Known destination before click and URL after navigation
   * @returns `allow`, `deny`, or `require-human` with a reason on the last two
   */
  check(action: CapabilityAction, context: PolicyCheckContext = {}): PolicyDecision {
    // Saved artifacts still cannot invent action types the tenant never allowed.
    if (!this.policy.allowedActionTypes.includes(action.type)) {
      return {
        decision: "deny",
        reason: `Action type ${action.type} is not allowed.`,
      };
    }
    const dangerous = dangerousActionReason(action);
    if (dangerous !== undefined) {
      // Independent of model labels: a "click" whose locator says "Wire funds"
      // must not execute even if the proposer tagged it safe.
      return { decision: "deny", reason: dangerous };
    }
    if ("risk" in action && action.risk === "risky") {
      const required = this.policy.approvalRequiredForRisk ?? ["risky"];
      if (required.includes("risky")) {
        // Escalate rather than deny so an operator can take the same session.
        return {
          decision: "require-human",
          reason: "Risky action requires human approval.",
        };
      }
      // Policy opted out of HITL for this risk; origin checks still apply.
    }
    const originDenial = this.denyIfOriginNotAllowed(context.destinationUrl)
      ?? this.denyIfOriginNotAllowed(context.resultingUrl);
    if (originDenial !== undefined) {
      return originDenial;
    }
    return { decision: "allow" };
  }

  /**
   * Deny when a known URL leaves the allowlisted origins.
   *
   * Missing or empty URLs skip the check: not every click exposes an href
   * before execute. A malformed URL throws from `new URL` so we fail closed
   * instead of treating garbage as on-origin.
   *
   * @param url - Destination peeked before click, or location after navigation
   * @returns A deny decision, or `undefined` when there is nothing to check
   */
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
