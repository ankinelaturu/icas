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
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Response } from "playwright";

import { SurfaceError } from "./surface-error.js";
import {
  descriptorFromLocator,
  locatorForSnapshotRef,
} from "./snapshot-ref.js";
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
   * Last main-frame document HTTP status. Cleared on close. Missing until a
   * document response is observed (file URLs and XHR screens may never set it).
   */
  private lastDocumentHttpStatus: number | undefined;

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
    this.lastDocumentHttpStatus = undefined;
    this.watchDocumentResponses(this.page);
    const response = await this.page.goto(url);
    this.recordDocumentResponse(response);
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
    this.lastDocumentHttpStatus = undefined;
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
   * Visual-first: legacy bank UIs often lack stable test ids. AI-mode aria
   * snapshots add `[ref=eN]` so discovery can bind the node the model named.
   * Replay never uses those refs.
   */
  async observe(): Promise<Observation> {
    const page = this.requirePage();
    const id = randomUUID();
    await mkdir(this.screenshotDir, { recursive: true });
    const imagePath = join(this.screenshotDir, `${id}.png`);
    await page.screenshot({ path: imagePath, fullPage: true });
    // AI mode stamps [ref=eN] on interactable nodes so discovery can click the
    // same node the model saw. Replay never consumes those refs.
    const accessibilitySnapshot = await page.locator("body").ariaSnapshot({
      mode: "ai",
      timeout: 5_000,
    });
    return {
      id,
      url: page.url(),
      imagePath,
      accessibilitySnapshot,
      metadata: { title: await page.title() },
      ...(this.lastDocumentHttpStatus === undefined
        ? {}
        : { httpStatus: this.lastDocumentHttpStatus }),
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
      case "navigate": {
        const destination = new URL(action.path, page.url()).href;
        await page.goto(destination);
        return { status: "ok", details: { url: page.url() } };
      }
      case "click":
      case "fill":
      case "select":
      case "read":
        return await this.performOnLocator(await this.locate(action.target), action);
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
   * Visible text of the current document, with no wait.
   *
   * Used to classify exceptional chrome after a locator miss. `innerText`
   * skips hidden nodes so banner copy matches what the operator sees.
   */
  async visibleText(): Promise<string> {
    this.assertAutomation();
    return await this.requirePage().locator("body").innerText();
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
   * Durable catalog locators for a snapshot ref from the last {@link observe}.
   *
   * Empty unlabeled inputs may still bind via `name=` CSS. When nothing
   * durable can be derived, this throws; discovery treats that as a skip and
   * keeps the model's locators.
   *
   * @param ref - `e12` from the AI aria snapshot
   * @returns Ranked strategies (typically `roleText` from the accessible name)
   */
  async bindSnapshotRef(ref: string): Promise<TargetDescriptor> {
    this.assertAutomation();
    const control = await this.requireSnapshotRef(ref);
    return await descriptorFromLocator(control);
  }

  /**
   * Anchor href for a snapshot-ref node, when the control is a link.
   *
   * @param ref - `e12` from the AI aria snapshot
   */
  async peekSnapshotRef(ref: string): Promise<string | undefined> {
    this.assertAutomation();
    const control = await this.requireSnapshotRef(ref);
    return await hrefOf(control, this.requirePage().url());
  }

  /**
   * Execute click/fill/select/read on the live snapshot-ref node.
   *
   * Navigate and handoff ignore `ref` and use {@link execute}.
   *
   * @param ref - `e12` from the AI aria snapshot
   * @param action - Semantic action; `target` is not consulted
   */
  async executeSnapshotRef(
    ref: string,
    action: CapabilityAction,
  ): Promise<SurfaceActionResult> {
    if (action.type === "navigate" || action.type === "handoff") {
      return await this.execute(action);
    }
    this.assertAutomation();
    const control = await this.requireSnapshotRef(ref);
    return await this.performOnLocator(control, action);
  }

  /**
   * Wait until the snapshot-ref node is visible, or throw TARGET_NOT_FOUND.
   *
   * @param ref - `e12` from the AI aria snapshot
   */
  private async requireSnapshotRef(ref: string): Promise<Locator> {
    const locator = locatorForSnapshotRef(this.requirePage(), ref).first();
    try {
      await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
    } catch {
      throw new SurfaceError(
        `TARGET_NOT_FOUND: snapshot ref ${ref} is not visible`,
        "TARGET_NOT_FOUND",
      );
    }
    return locator;
  }

  /**
   * Click, fill, select, or read an already-resolved locator.
   *
   * Shared by {@link execute} (ranked target) and {@link executeSnapshotRef}.
   *
   * @param control - Visible Playwright locator
   * @param action - Click/fill/select/read
   */
  private async performOnLocator(
    control: Locator,
    action: Extract<CapabilityAction, { type: "click" | "fill" | "select" | "read" }>,
  ): Promise<SurfaceActionResult> {
    const page = this.requirePage();
    switch (action.type) {
      case "click": {
        // Record href before click; after navigation `page.url()` is the landing page.
        const destinationUrl = await hrefOf(control, page.url());
        await control.click();
        return {
          status: "ok",
          details: { destinationUrl, resultingUrl: page.url() },
        };
      }
      case "fill": {
        await control.fill(literalString(action.value));
        return { status: "ok" };
      }
      case "select": {
        await control.selectOption(literalString(action.value));
        return { status: "ok" };
      }
      case "read": {
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

  /**
   * Record main-frame document responses only. XHR and iframe documents are
   * not this field; replay treats a missing status as normal.
   */
  private watchDocumentResponses(page: Page): void {
    page.on("response", (response) => {
      this.recordDocumentResponse(response);
    });
  }

  /**
   * Keep the latest main-document status when Playwright exposed one.
   *
   * `goto` can return null (some file URLs). The response listener still
   * captures later in-page navigations.
   *
   * @param response - Playwright document response, or null from `goto`
   */
  private recordDocumentResponse(response: Response | null): void {
    if (response === null) {
      return;
    }
    if (response.request().resourceType() !== "document") {
      return;
    }
    const page = this.page;
    if (page === undefined || response.frame() !== page.mainFrame()) {
      return;
    }
    this.lastDocumentHttpStatus = response.status();
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
