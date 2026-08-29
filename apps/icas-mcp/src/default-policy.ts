/**
 * @file Runtime PolicyGuard for icas-mcp replay.
 *
 * MCP defaults to headless Chromium because stdout is the protocol byte stream.
 * Prompt markdown is not enforcement.
 */

import type { CapabilityAction } from "@icas/capability";
import { PolicyGuard, type RuntimePolicy } from "@icas/policy";

import { originFromUrl } from "./origin-from-url.js";

/** Action vocabulary ReplayEngine and discovery already share. */
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
 * Allowed origin is the URL's origin only. Do not add extra hosts because the
 * hostname looked like a bank name.
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
