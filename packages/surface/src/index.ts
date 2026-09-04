/**
 * @file Surface — observation/action seam independent of Playwright.
 *
 * Playwright is the first implementation, not the artifact model. A future
 * desktop backend can map the same semantic actions to OS automation while
 * capability JSON stays unchanged.
 */

import type {
  Assertion,
  CapabilityAction,
  TargetDescriptor,
} from "@icas/capability";

/**
 * One captured view of the live surface (screenshot plus optional extras).
 *
 * `imagePath` is the visual-first signal. Accessibility/DOM extras help
 * evidence and repair, but locators should not depend on clean test ids.
 */
export interface Observation {
  id: string;
  url?: string;
  imagePath?: string;
  accessibilitySnapshot?: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Main-document HTTP status when the surface observed it.
   *
   * Missing is valid: file URLs, XHR-driven screens, frames, and some 200
   * error banners never expose a document status. Replay must not treat omit
   * as a classifier miss.
   */
  httpStatus?: number;
}

/**
 * Result of executing one semantic action.
 *
 * `blocked` / `failed` stay structured so ReplayEngine classifies instead
 * of catching a throw for every denied click.
 */
export interface SurfaceActionResult {
  status: "ok" | "blocked" | "failed";
  details?: unknown;
}

/**
 * Who currently issues actions on the live session.
 *
 * HITL flips this on the same session. Automation must not click while
 * `human` owns control.
 */
export type ControlOwner = "automation" | "human";

/**
 * How a capability observes and acts on a UI. Playwright is the first
 * implementation, not the artifact model.
 */
export interface Surface {
  /**
   * Launch the surface session and navigate to `url`.
   */
  open(url: string): Promise<void>;

  /**
   * Close the session. Safe to call more than once.
   */
  close(): Promise<void>;

  /**
   * Capture a screenshot and optional accessibility extras for evidence/repair.
   */
  observe(): Promise<Observation>;

  /**
   * Run one semantic action. ValueRefs must already be literals.
   */
  execute(action: CapabilityAction): Promise<SurfaceActionResult>;

  /**
   * Bounded wait/check. Return false on timeout rather than throwing.
   */
  assert(assertion: Assertion): Promise<boolean>;

  /**
   * Visible text of the current view, with no wait.
   *
   * Replay uses this to classify `possibleOutcomes` after the next locator
   * already missed. Do not wait for phrases to appear here.
   */
  visibleText(): Promise<string>;

  /**
   * Resolve a ranked {@link TargetDescriptor} to a surface-native handle.
   */
  locate(target: TargetDescriptor): Promise<unknown>;
  /**
   * Absolute URL a click would navigate to, when known (e.g. an anchor href).
   *
   * Policy uses this before execute so off-origin destinations can be denied
   * without clicking them.
   */
  peekDestination(target: TargetDescriptor): Promise<string | undefined>;
  /**
   * Discovery-only: durable locators for a snapshot ref from the last observe().
   *
   * Replay never calls this. Refs are session-scoped; the returned descriptor
   * is what compile writes to the catalog.
   */
  bindSnapshotRef(ref: string): Promise<TargetDescriptor>;
  /**
   * Discovery-only: href for the node a snapshot ref currently points at.
   */
  peekSnapshotRef(ref: string): Promise<string | undefined>;
  /**
   * Discovery-only: click/fill/select/read the live snapshot-ref node.
   *
   * Uses the same semantic `action` as {@link execute} but does not re-resolve
   * `action.target`. After this succeeds, discovery replaces that target with
   * {@link bindSnapshotRef} so backtrack and replay use durable locators.
   */
  executeSnapshotRef(
    ref: string,
    action: CapabilityAction,
  ): Promise<SurfaceActionResult>;
  /**
   * Pause automation and leave the same session open for a human.
   */
  handoffToHuman(): Promise<void>;
  /**
   * Return control to automation on the same session.
   */
  resumeFromHuman(): Promise<void>;
}
