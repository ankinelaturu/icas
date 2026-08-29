/**
 * @file PlaywrightSurface — Playwright implementation of the Surface seam.
 *
 * First browser backend, not the artifact model. Capabilities stay semantic
 * (click/fill/assert). This class owns Chromium lifecycle, ranked locators,
 * bounded waits, and same-session HITL ownership.
 */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Assertion,
  CapabilityAction,
  TargetDescriptor,
  ValueRef,
} from "@icas/capability";
import { resolveValueRef } from "@icas/capability";
import type {
  ControlOwner,
  Observation,
  Surface,
  SurfaceActionResult,
} from "@icas/surface";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { SurfaceError } from "./surface-error.js";

import { resolveTarget } from "./target-resolver.js";

/**
 * Launch and wait knobs. Production defaults to a headed session so HITL
 * can take the same window; tests pass `headed: false`.
 */
export interface PlaywrightSurfaceOptions {
  /**
   * When true (default), launch a headed window. Tests pass `false`.
   */
  headed?: boolean;
  /**
   * Bound for locator waits, in milliseconds. Default 10_000.
   */
  timeoutMs?: number;
  /**
   * Poll interval for value/state assertions, in milliseconds. Default 250.
   */
  pollingMs?: number;
  /**
   * Directory for observation screenshots. Defaults to the OS temp dir.
   */
  screenshotDir?: string;
}

/**
 * Browser-backed {@link Surface}. Production defaults to a headed session.
 *
 * `close` is idempotent. Automation actions throw {@link SurfaceError}
 * `HUMAN_HAS_CONTROL` while a human owns the same page.
 */
export class PlaywrightSurface implements Surface {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly headed: boolean;
  private readonly timeoutMs: number;
  private readonly pollingMs: number;
  private readonly screenshotDir: string;
  private owner: ControlOwner = "automation";

  /**
   * @param options.headed - Headed window when true; tests should pass false
   * @param options.timeoutMs - Locator wait budget; default 10_000
   * @param options.pollingMs - Assertion poll interval; default 250
   * @param options.screenshotDir - Where observe() writes PNGs
   */
  constructor(options: PlaywrightSurfaceOptions = {}) {
    this.headed = options.headed ?? true;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.pollingMs = options.pollingMs ?? 250;
    this.screenshotDir = options.screenshotDir ?? tmpdir();
  }

  /**
   * Launch Chromium, open a page, and navigate to `url`.
   *
   * Closes any prior session first so a second `open` does not leak processes.
   */
  async open(url: string): Promise<void> {
    await this.close();
    this.browser = await chromium.launch({ headless: !this.headed });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    await this.page.goto(url);
  }

  /**
   * Close the browser. No-ops when already closed.
   *
   * Clears handles before `browser.close` so a concurrent close sees an
   * already-torn-down session rather than double-closing Chromium.
   */
  async close(): Promise<void> {
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.owner = "automation";
    if (browser !== undefined) {
      await browser.close();
    }
  }

  /**
   * Current page URL after {@link open}.
   *
   * @throws {Error} When no page is open
   */
  url(): string {
    return this.requirePage().url();
  }

  /**
   * Capture a full-page screenshot plus optional accessibility tree.
   *
   * Visual-first: legacy bank UIs often lack stable test ids. The a11y
   * snapshot is a supplement for evidence, not a required locator source.
   */
  async observe(): Promise<Observation> {
    const page = this.requirePage();
    const id = randomUUID();
    await mkdir(this.screenshotDir, { recursive: true });
    const imagePath = join(this.screenshotDir, `${id}.png`);
    await page.screenshot({ path: imagePath, fullPage: true });
    const accessibilitySnapshot = await page.locator("body").ariaSnapshot();
    return {
      id,
      url: page.url(),
      imagePath,
      accessibilitySnapshot,
      metadata: { title: await page.title() },
    };
  }

  /**
   * Run one semantic action. `ValueRef` inputs must already be resolved to literals.
   *
   * Replay hydrates fill/select before this call. `handoff` is allowed even
   * when a human already owns control so a capability-encoded pause is not
   * rejected by {@link assertAutomation}.
   */
  async execute(action: CapabilityAction): Promise<SurfaceActionResult> {
    if (action.type !== "handoff") {
      this.assertAutomation();
    }
    const page = this.requirePage();
    switch (action.type) {
      case "handoff": {
        await this.handoffToHuman();
        return { status: "ok", details: { reason: action.reason } };
      }
      case "click": {
        const control = await this.locate(action.target);
        // Record href before click; after navigation `page.url()` is the landing page.
        const destinationUrl = await hrefOf(control, page.url());
        await control.click();
        return {
          status: "ok",
          details: { destinationUrl, resultingUrl: page.url() },
        };
      }
      case "fill": {
        const control = await this.locate(action.target);
        await control.fill(literalString(action.value));
        return { status: "ok" };
      }
      case "select": {
        const control = await this.locate(action.target);
        await control.selectOption(literalString(action.value));
        return { status: "ok" };
      }
      case "navigate": {
        const destination = new URL(action.path, page.url()).href;
        await page.goto(destination);
        return { status: "ok", details: { url: page.url() } };
      }
      case "read": {
        const control = await this.locate(action.target);
        const value = await readControlValue(control);
        return { status: "ok", details: { value } };
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }

  /**
   * Check an assertion with bounded waits. Returns false on timeout or mismatch.
   *
   * Timeouts become `false` rather than throws so ReplayEngine can classify
   * (precondition vs postcondition vs business outcome) instead of crashing.
   */
  async assert(assertion: Assertion): Promise<boolean> {
    this.assertAutomation();
    const page = this.requirePage();
    try {
      switch (assertion.type) {
        case "textVisible": {
          const text = assertionString(assertion.value);
          await page
            .getByText(text)
            .first()
            .waitFor({ state: "visible", timeout: this.timeoutMs });
          return true;
        }
        case "controlPresent":
          await this.locate(assertion.target);
          return true;
        case "valueEquals": {
          const control = await this.locate(assertion.target);
          const expected = assertionString(assertion.value);
          const deadline = Date.now() + this.timeoutMs;
          while (Date.now() < deadline) {
            const actual = await readControlValue(control);
            if (actual === expected) {
              return true;
            }
            await page.waitForTimeout(this.pollingMs);
          }
          return false;
        }
        case "urlMatches": {
          const pattern = assertion.pattern;
          await page.waitForURL(
            (url) =>
              url.href.includes(pattern) || new RegExp(pattern).test(url.href),
            { timeout: this.timeoutMs },
          );
          return true;
        }
        case "state": {
          const expected = assertionString(assertion.value);
          const loc = page.locator(`[data-icas-state="${assertion.key}"]`);
          await loc.waitFor({ state: "visible", timeout: this.timeoutMs });
          await page.waitForFunction(
            ({ key, expectedValue }) => {
              const el = document.querySelector(`[data-icas-state="${key}"]`);
              return el?.textContent?.trim() === expectedValue;
            },
            { key: assertion.key, expectedValue: expected },
            { timeout: this.timeoutMs, polling: this.pollingMs },
          );
          return true;
        }
        default: {
          const exhaustive: never = assertion;
          return exhaustive;
        }
      }
    } catch {
      return false;
    }
  }

  /**
   * Resolve a ranked target to a Playwright locator.
   *
   * @throws {SurfaceError} `TARGET_NOT_FOUND` when no strategy matches
   */
  async locate(target: TargetDescriptor): Promise<Locator> {
    this.assertAutomation();
    return await resolveTarget(this.requirePage(), target, this.timeoutMs);
  }

  /**
   * Resolve an in-page href to an absolute URL when the target is an anchor.
   *
   * Used by policy before click. Non-anchors return `undefined` rather than
   * inventing a destination.
   */
  async peekDestination(target: TargetDescriptor): Promise<string | undefined> {
    this.assertAutomation();
    const control = await this.locate(target);
    return await hrefOf(control, this.requirePage().url());
  }

  /**
   * Pause automation. The headed session stays open for a human operator.
   *
   * HITL is control transfer of this page, not a second browser or co-browse.
   */
  async handoffToHuman(): Promise<void> {
    this.requirePage();
    this.owner = "human";
  }

  /**
   * Resume automation on the same session.
   */
  async resumeFromHuman(): Promise<void> {
    this.requirePage();
    this.owner = "automation";
  }

  /**
   * Who currently may issue actions.
   */
  controlOwner(): ControlOwner {
    return this.owner;
  }

  /**
   * Reject clicks/fills while a human owns the session.
   *
   * @throws {SurfaceError} `HUMAN_HAS_CONTROL`
   */
  private assertAutomation(): void {
    if (this.owner === "human") {
      throw new SurfaceError(
        "automation is paused; human owns the session",
        "HUMAN_HAS_CONTROL",
      );
    }
  }

  /**
   * @throws {Error} When `open` has not run or `close` already tore down the page
   */
  private requirePage(): Page {
    if (this.page === undefined) {
      throw new Error("PlaywrightSurface has no open page; call open() first.");
    }
    return this.page;
  }
}

/**
 * Accept a raw string or a ValueRef that replay already turned into `{ literal }`.
 */
function assertionString(value: string | ValueRef): string {
  if (typeof value === "string") {
    return value;
  }
  return literalString(value);
}

/**
 * Resolve a ValueRef with an empty input map.
 *
 * Replay hydrates `{ fromInput }` first. An unresolved fromInput here means
 * a caller skipped hydrate — fail loudly rather than filling `undefined`.
 */
function literalString(ref: ValueRef): string {
  const value = resolveValueRef(ref, {});
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("action value must resolve to a string, number, or boolean");
}

/**
 * Absolute URL for an anchor href, or `undefined` when the control is not a link.
 */
async function hrefOf(
  control: Locator,
  baseUrl: string,
): Promise<string | undefined> {
  const href = await control.getAttribute("href");
  if (href === null || href.length === 0) {
    return undefined;
  }
  return new URL(href, baseUrl).href;
}

/**
 * Prefer form `inputValue` for inputs; inner text for everything else.
 *
 * Buttons and payoff amounts live in non-input nodes on the bank fixture.
 */
async function readControlValue(control: Locator): Promise<string> {
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return await control.inputValue();
  }
  return (await control.innerText()).trim();
}
