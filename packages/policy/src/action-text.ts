/**
 * @file action-text — inspect control labels/intent independently of model risk tags.
 */

import type { CapabilityAction, TargetDescriptor } from "@icas/capability";

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
 */
export function dangerousActionReason(action: CapabilityAction): string | undefined {
  const text = collectActionText(action);
  for (const pattern of DANGEROUS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return `Dangerous control text or intent is not allowed: ${text.trim()}`;
    }
  }
  return undefined;
}

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
