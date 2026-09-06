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
 * locator API. `roleText` / `visibleText` use substring name matching so a
 * catalog phrase like "Primary Share" still hits a tile whose accessible name
 * concatenates share id and available balance. `label` and `relative` anchors
 * stay exact so a short caption does not match a longer unrelated label.
 */
function locatorFor(page: Page, strategy: TargetStrategy): Locator | undefined {
  switch (strategy.type) {
    case "roleText":
      return page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], {
        name: strategy.text,
        exact: false,
      });
    case "visibleText":
      return page.getByText(strategy.text, { exact: false });
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
 * Caption nodes that are page titles, not field labels.
 *
 * A confirmation screen often repeats the heading as a row caption. Exact
 * `getByText` would bind the `<h1>` first; the value lives on a later sibling
 * of the field caption, not of the heading.
 */
const RELATIVE_CAPTION_XPATH =
  "self::*[not(self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6 or @role='heading')]";

/**
 * Default `relative` when the catalog omitted `xpath` / `role`.
 *
 * One relationship: the caption's following sibling is the value or control.
 * If that sibling wraps `input` / `textarea` / `select`, use the control so a
 * fill does not target the wrapper. If the caption has no sibling, fall back to
 * the next form control in document order (caption then input, not siblings).
 * Do not name tenant tags (`td`, `div.val`) here.
 */
const DEFAULT_RELATIVE_XPATH = [
  "following-sibling::*[1]/descendant-or-self::*[self::input or self::textarea or self::select][1]",
  "following-sibling::*[1][not(descendant-or-self::input or descendant-or-self::textarea or descendant-or-self::select)]",
  "self::*[not(following-sibling::*)]/following::*[self::input or self::textarea or self::select][1]",
].join(" | ");

/**
 * Locate a control relative to visible anchor text.
 *
 * Prefer an explicit xpath, then a role under following siblings. Default is
 * the caption's following sibling (control if it wraps one), else the next
 * form control when the caption has no sibling. Headings with the same string
 * are not captions.
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
  const caption = anchor.locator(`xpath=${RELATIVE_CAPTION_XPATH}`);
  return caption.locator(`xpath=${DEFAULT_RELATIVE_XPATH}`);
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
