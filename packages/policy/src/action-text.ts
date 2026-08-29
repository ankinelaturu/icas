/**
 * @file action-text — inspect control labels/intent independently of model risk tags.
 *
 * The proposer can mark a wire transfer as `safe`. Locator text and stated
 * intent still go through these patterns so PolicyGuard can deny without
 * trusting self-classification.
 *
 * @see PolicyGuard.check
 */

import type { CapabilityAction, TargetDescriptor } from "@icas/capability";

/** Banking verbs that must never execute even if the model omitted `risk`. */
const DANGEROUS = [
  /\btransfer(\s+funds?)?\b/i,
  /\bwire\b/i,
  /\bach\b/i,
  /\b(make\s+a\s+)?payment\b/i,
  /\bpay\s+(now|bill|loan)\b/i,
  /\bdelete\b/i,
  /\bclose\s+(the\s+)?account\b/i,
  /\bmodify\s+loan\s+terms?\b/i,
];

/**
 * Collect intent and locator text the runtime can inspect without the model.
 *
 * A click whose button reads "Wire funds" is still a wire even when `intent`
 * is missing. Concatenation keeps the matcher on one string.
 *
 * @param action - Proposed or recorded action
 * @returns Space-joined intent, reason, and target strategy labels
 */
export function collectActionText(action: CapabilityAction): string {
  const parts: string[] = [];
  if ("intent" in action && action.intent !== undefined) {
    parts.push(action.intent);
  }
  if ("reason" in action) {
    parts.push(action.reason);
  }
  if ("target" in action) {
    parts.push(targetText(action.target));
  }
  return parts.join(" ");
}

/**
 * Return a deny reason when control text/intent looks like a prohibited banking action.
 *
 * This is deny, not require-human: synthetic tenants must not move money even
 * with an operator present.
 *
 * @param action - Proposed or recorded action
 * @returns Deny reason, or `undefined` when no pattern matches
 */
export function dangerousActionReason(action: CapabilityAction): string | undefined {
  const text = collectActionText(action);
  for (const pattern of DANGEROUS) {
    // Global regexes retain lastIndex; reset so a later `/g` flag cannot skip.
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return `Dangerous control text or intent is not allowed: ${text.trim()}`;
    }
  }
  return undefined;
}

/**
 * Flatten locator strategies to visible labels the operator would read.
 *
 * @param target - Replay target whose strategies may carry `text` or `label`
 * @returns Joined strategy strings; empty strategies contribute nothing
 */
function targetText(target: TargetDescriptor): string {
  return target.strategies
    .map((strategy) => {
      if ("text" in strategy && strategy.text !== undefined) {
        return strategy.text;
      }
      if ("label" in strategy && strategy.label !== undefined) {
        return strategy.label;
      }
      return "";
    })
    .join(" ");
}
