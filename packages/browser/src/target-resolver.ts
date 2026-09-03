/**
 * @file resolveTarget — try ranked TargetDescriptor strategies against a Playwright page.
 *
 * Replay prefers stable semantic locators over coordinates. Strategies run in
 * array order; the first visible match wins. A miss continues to the next rank
 * instead of throwing, so a stale CSS selector can fall through to role/text.
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
    const locator =
      strategy.type === "coordinates"
        ? await resolveCoordinates(page, strategy.x, strategy.y)
        : locatorFor(page, strategy);
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

/**
 * Map a non-coordinate strategy to a Playwright locator.
 *
 * Coordinates are handled separately because `elementFromPoint` is not a
 * locator API. `exact: true` avoids substring matches on similar bank labels.
 */
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
    case "css":
      return page.locator(strategy.selector);
    case "xpath":
      return page.locator(`xpath=${strategy.selector}`);
    case "relative":
      return relativeLocator(page, strategy);
    case "coordinates":
      return undefined;
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

/**
 * Locate a control relative to visible anchor text.
 *
 * Prefer an explicit xpath, then a role under following siblings. Default is
 * the nearest following form control, or a table cell that does not wrap one.
 */
function relativeLocator(
  page: Page,
  strategy: Extract<TargetStrategy, { type: "relative" }>,
): Locator {
  const anchor = page.getByText(strategy.text, { exact: true });
  if (strategy.xpath !== undefined) {
    return anchor.locator(`xpath=${strategy.xpath}`);
  }
  if (strategy.role !== undefined) {
    return anchor.locator("xpath=following::*").getByRole(
      strategy.role as Parameters<Page["getByRole"]>[0],
    );
  }
  // Bank inquiry rows are caption td + value td wrapping <input>. A bare
  // `self::td` would fill that wrapper. Skip cells that already contain a
  // control; statement amount cells have no input, so they still match.
  return anchor.locator(
    "xpath=following::*[self::input or self::textarea or self::select or (self::td and not(.//input or .//textarea or .//select))][1]",
  );
}

/**
 * Hit-test (x, y) and stamp a temporary attribute Playwright can locate.
 *
 * Last-resort strategy: coordinates drift across layout. Clear previous hits
 * so only one element matches `data-icas-coord-hit`.
 */
async function resolveCoordinates(
  page: Page,
  x: number,
  y: number,
): Promise<Locator | undefined> {
  const attr = "data-icas-coord-hit";
  await page.evaluate((name) => {
    for (const el of document.querySelectorAll(`[${name}]`)) {
      el.removeAttribute(name);
    }
  }, attr);
  const hit = await page.evaluate(
    ({ px, py, name }) => {
      const el = document.elementFromPoint(px, py);
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      el.setAttribute(name, "1");
      return true;
    },
    { px: x, py: y, name: attr },
  );
  if (!hit) {
    return undefined;
  }
  return page.locator(`[${attr}="1"]`);
}

/**
 * Wait until the first match is visible, or give up for this strategy.
 *
 * Timeout is per rank so a dead CSS selector does not consume later
 * role/text strategies — they each get the same bound.
 */
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

/**
 * Human-readable rank for the TARGET_NOT_FOUND message.
 *
 * Operators need the tried list to see whether discovery emitted a stale
 * selector or the page never showed the control.
 */
function describeStrategy(strategy: TargetStrategy): string {
  switch (strategy.type) {
    case "roleText":
      return `roleText role=${strategy.role} text=${strategy.text}`;
    case "visibleText":
      return `visibleText text=${strategy.text}`;
    case "label":
      return `label=${strategy.label}`;
    case "css":
      return `css=${strategy.selector}`;
    case "xpath":
      return `xpath=${strategy.selector}`;
    case "relative":
      return `relative text=${strategy.text}`;
    case "coordinates":
      return `coordinates ${strategy.x},${strategy.y}`;
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}
