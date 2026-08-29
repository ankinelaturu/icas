/**
 * @file Surface — observation/action seam independent of Playwright.
 */

import type {
  Assertion,
  CapabilityAction,
  TargetDescriptor,
} from "@icas/capability";

/**
 * One captured view of the live surface (screenshot plus optional extras).
 */
export interface Observation {
  id: string;
  url?: string;
  imagePath?: string;
  accessibilitySnapshot?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Result of executing one semantic action.
 */
export interface SurfaceActionResult {
  status: "ok" | "blocked" | "failed";
  details?: unknown;
}

/**
 * Who currently issues actions on the live session.
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

  observe(): Promise<Observation>;
  execute(action: CapabilityAction): Promise<SurfaceActionResult>;
  assert(assertion: Assertion): Promise<boolean>;
  locate(target: TargetDescriptor): Promise<unknown>;
  /**
   * Absolute URL a click would navigate to, when known (e.g. an anchor href).
   */
  peekDestination(target: TargetDescriptor): Promise<string | undefined>;
  /**
   * Pause automation and leave the same session open for a human.
   */
  handoffToHuman(): Promise<void>;
  /**
   * Return control to automation on the same session.
   */
  resumeFromHuman(): Promise<void>;
}
