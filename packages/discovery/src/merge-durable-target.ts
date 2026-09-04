/**
 * @file mergeDurableTarget — put live-node locators ahead of the model's guess.
 *
 * Discovery executes by snapshot ref, then stamps {@link TargetDescriptor}
 * strategies from that node. The model's copied `visibleText` stays as a later
 * rank so a bind that only produced CSS still has a semantic fallback.
 */

import type { CapabilityAction, TargetDescriptor } from "@icas/capability";

/**
 * Replace the action target with durable strategies first, then the proposal.
 *
 * Navigate/handoff have no target and are returned unchanged.
 *
 * @param action - Catalog action (possibly still holding the model's locators)
 * @param durable - Locators derived from the live snapshot-ref node
 * @returns Action whose `target.strategies` start with `durable`
 */
export function mergeDurableTarget(
  action: CapabilityAction,
  durable: TargetDescriptor,
): CapabilityAction {
  if (!("target" in action)) {
    return action;
  }
  return {
    ...action,
    target: {
      strategies: uniqueStrategies([...durable.strategies, ...action.target.strategies]),
    },
  };
}

/**
 * Drop duplicate strategies after merging durable and proposed ranks.
 *
 * @param strategies - Ranked locators, possibly with repeats
 */
function uniqueStrategies(
  strategies: TargetDescriptor["strategies"],
): TargetDescriptor["strategies"] {
  const seen = new Set<string>();
  const unique: TargetDescriptor["strategies"] = [];
  for (const strategy of strategies) {
    const key = JSON.stringify(strategy);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(strategy);
  }
  return unique;
}
