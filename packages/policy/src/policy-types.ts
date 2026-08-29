/**
 * @file Policy types — runtime allow / deny / require-human contract.
 *
 * Prompt markdown lives beside this package as data. These types describe the
 * executable guard, not the injectable text.
 *
 * @see PolicyGuard
 */

import type { CapabilityAction } from "@icas/capability";

/**
 * Runtime execution policy. Prompt markdown is not a substitute for this.
 *
 * Replay and assisted fallback both honor the same allowlists so a stored
 * artifact cannot outrun tenant safety.
 */
export interface RuntimePolicy {
  /** Origins the headed session may navigate to; off-origin is always deny. */
  allowedOrigins: string[];
  /** Action types Surface.execute may perform; unknown types fail closed. */
  allowedActionTypes: CapabilityAction["type"][];
  /**
   * Risk tags that pause automation for a human on the same session.
   * Defaults to `["risky"]` inside {@link PolicyGuard.check} when omitted.
   */
  approvalRequiredForRisk?: Array<"risky">;
}

/**
 * Outcome of {@link PolicyGuard.check}.
 *
 * `allow` proceeds to Surface.execute. `deny` stops the step. `require-human`
 * is HITL on the existing headed session, not a second browser or co-browse.
 */
export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "require-human"; reason: string };

/**
 * Navigation context for origin checks.
 *
 * The model can propose any URL. The executor supplies what it actually knows:
 * a peeked href before click, and the location after the action lands.
 */
export interface PolicyCheckContext {
  /** Page the session is on when the action is proposed. */
  currentUrl?: string;
  /** Known destination (for example an anchor href) before click. */
  destinationUrl?: string;
  /** Browser location after the action; catches navigations with no pre-click href. */
  resultingUrl?: string;
}
