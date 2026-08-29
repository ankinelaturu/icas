/**
 * @file PlaywrightSurface — Playwright implementation of the Surface seam.
 */

import type { Assertion, CapabilityAction, TargetDescriptor } from "@icas/capability";
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

  /**
   * @param options.headed - Headed window when true; tests should pass false
   * @param options.timeoutMs - Locator wait budget; default 10_000
   */
  constructor(options: PlaywrightSurfaceOptions = {}) {
    this.headed = options.headed ?? true;
    this.timeoutMs = options.timeoutMs ?? 10_000;
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

  async execute(_action: CapabilityAction): Promise<SurfaceActionResult> {
    throw new Error("PlaywrightSurface.execute is a scaffold.");
  }

  async assert(_assertion: Assertion): Promise<boolean> {
    throw new Error("PlaywrightSurface.assert is a scaffold.");
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
