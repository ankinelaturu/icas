/**
 * @file mergeDurableTarget — keep the model's locators; append bind identity only.
 *
 * Discovery executes by snapshot ref. The catalog must not store the live
 * node's accessible name: that string often concatenates this run's balances
 * and ids. CSS `#id` / `[name=]` and an associated `<label>` are identity, not
 * instance chrome, so those bind ranks stay as fallbacks after the proposal.
 */

import type { CapabilityAction, TargetDescriptor } from "@icas/capability";

type TargetStrategy = TargetDescriptor["strategies"][number];

/**
 * Strategies that identify a control without copying this run's displayed data.
 *
 * `roleText` / `visibleText` from bind are collapsed innerText of the live
 * node. Those go in the catalog only when the model emitted them.
 */
function identityStrategies(
  durable: TargetDescriptor,
): TargetDescriptor["strategies"] {
  return durable.strategies.filter(
    (strategy): strategy is Extract<TargetStrategy, { type: "css" | "label" }> =>
      strategy.type === "css" || strategy.type === "label",
  );
}

/**
 * Keep the proposed locators first. Append bind CSS/label after.
 *
 * Navigate/handoff have no target and are returned unchanged.
 *
 * @param action - Catalog action (model locators, never a snapshot ref)
 * @param durable - Locators derived from the live snapshot-ref node
 * @returns Action whose `target.strategies` start with the proposal
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
      strategies: uniqueStrategies([
        ...action.target.strategies,
        ...identityStrategies(durable),
      ]),
    },
  };
}

/**
 * Drop duplicate strategies after merging proposed and bind identity ranks.
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
