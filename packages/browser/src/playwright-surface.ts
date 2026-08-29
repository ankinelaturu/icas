/**
 * @file PlaywrightSurface — Playwright implementation of the Surface seam.
 */

import type { Assertion, CapabilityAction, TargetDescriptor, ValueRef } from "@icas/capability";
import { resolveValueRef } from "@icas/capability";
import type {
  Observation,
  Surface,
  SurfaceActionResult,
} from "@icas/surface";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { resolveTarget } from "./target-resolver.js";

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
}

/**
 * Browser-backed {@link Surface}. Production defaults to a headed session.
 */
export class PlaywrightSurface implements Surface {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly headed: boolean;
  private readonly timeoutMs: number;
  private readonly pollingMs: number;

  /**
   * @param options.headed - Headed window when true; tests should pass false
   * @param options.timeoutMs - Locator wait budget; default 10_000
   * @param options.pollingMs - Assertion poll interval; default 250
   */
  constructor(options: PlaywrightSurfaceOptions = {}) {
    this.headed = options.headed ?? true;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.pollingMs = options.pollingMs ?? 250;
  }

  /**
   * Launch Chromium, open a page, and navigate to `url`.
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
   */
  async close(): Promise<void> {
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
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

  async observe(): Promise<Observation> {
    throw new Error("PlaywrightSurface.observe is a scaffold.");
  }

  /**
   * Run one semantic action. `ValueRef` inputs must already be resolved to literals.
   */
  async execute(action: CapabilityAction): Promise<SurfaceActionResult> {
    const page = this.requirePage();
    switch (action.type) {
      case "click": {
        const control = await this.locate(action.target);
        await control.click();
        return { status: "ok", details: { url: page.url() } };
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
      case "handoff":
        throw new Error("PlaywrightSurface.execute handoff is implemented in pass 2.9.");
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }

  /**
   * Check an assertion with bounded waits. Returns false on timeout or mismatch.
   */
  async assert(assertion: Assertion): Promise<boolean> {
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
    return await resolveTarget(this.requirePage(), target, this.timeoutMs);
  }

  async handoffToHuman(): Promise<void> {
    throw new Error("PlaywrightSurface.handoffToHuman is a scaffold.");
  }

  private requirePage(): Page {
    if (this.page === undefined) {
      throw new Error("PlaywrightSurface has no open page; call open() first.");
    }
    return this.page;
  }
}

function assertionString(value: string | ValueRef): string {
  if (typeof value === "string") {
    return value;
  }
  return literalString(value);
}

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

async function readControlValue(control: Locator): Promise<string> {
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return await control.inputValue();
  }
  return (await control.innerText()).trim();
}
