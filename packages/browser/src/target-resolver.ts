/**
 * @file resolveTarget — try ranked TargetDescriptor strategies against a Playwright page.
 */

import type { TargetDescriptor } from "@icas/capability";
import type { Locator, Page } from "playwright";

import { SurfaceError } from "./surface-error.js";

type TargetStrategy = TargetDescriptor["strategies"][number];

/**
 * Return the first visible control matching `target.strategies` in order.
 *
 * @throws {SurfaceError} `TARGET_NOT_FOUND` when no strategy matches
 */
export async function resolveTarget(
  page: Page,
  target: TargetDescriptor,
  timeoutMs: number,
): Promise<Locator> {
  const tried: string[] = [];
  for (const strategy of target.strategies) {
    tried.push(describeStrategy(strategy));
    const locator = locatorFor(page, strategy);
    if (locator === undefined) {
      continue;
    }
    const visible = await firstVisible(locator, timeoutMs);
    if (visible !== undefined) {
      return visible;
    }
  }
  throw new SurfaceError(
    `TARGET_NOT_FOUND: no control matched [${tried.join("; ")}]`,
    "TARGET_NOT_FOUND",
  );
}

function locatorFor(page: Page, strategy: TargetStrategy): Locator | undefined {
  switch (strategy.type) {
    case "roleText":
      return page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], {
        name: strategy.text,
        exact: true,
      });
    case "visibleText":
      return page.getByText(strategy.text, { exact: true });
    case "label":
      return page.getByLabel(strategy.label, { exact: true });
    default:
      return undefined;
  }
}

async function firstVisible(
  locator: Locator,
  timeoutMs: number,
): Promise<Locator | undefined> {
  const first = locator.first();
  try {
    await first.waitFor({ state: "visible", timeout: timeoutMs });
    return first;
  } catch {
    return undefined;
  }
}

function describeStrategy(strategy: TargetStrategy): string {
  switch (strategy.type) {
    case "roleText":
      return `roleText role=${strategy.role} text=${strategy.text}`;
    case "visibleText":
      return `visibleText text=${strategy.text}`;
    case "label":
      return `label=${strategy.label}`;
    default:
      return strategy.type;
  }
}
