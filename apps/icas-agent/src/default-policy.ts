/**
 * @file Runtime PolicyGuard for icas-agent discovery.
 *
 * Prompt markdown is not enforcement. Every proposed action still goes through
 * this guard before Surface.execute.
 */

import type { CapabilityAction } from "@icas/capability";
import { PolicyGuard, type RuntimePolicy } from "@icas/policy";

import { originFromUrl } from "./origin-from-url.js";

/** Action vocabulary discovery and replay already share. */
export const DEFAULT_ALLOWED_ACTION_TYPES: CapabilityAction["type"][] = [
  "click",
  "fill",
  "select",
  "navigate",
  "read",
  "handoff",
];

/**
 * Build a fail-closed guard for one `--url`.
 *
 * @param url - Surface entry URL from `--url`
 */
export function policyGuardForUrl(url: string): PolicyGuard {
  const policy: RuntimePolicy = {
    allowedOrigins: [originFromUrl(url)],
    allowedActionTypes: DEFAULT_ALLOWED_ACTION_TYPES,
    approvalRequiredForRisk: ["risky"],
  };
  return new PolicyGuard(policy);
}
