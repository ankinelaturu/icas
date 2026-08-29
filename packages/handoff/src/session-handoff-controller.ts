/**
 * @file SessionHandoffController — automation/human ownership for one live session.
 *
 * HITL is control transfer of the same headed browser, not a co-browsing
 * console and not a second window. While `owner()` is `human`, callers must
 * skip Surface.execute.
 *
 * @see takeOverBrowser
 * @see HandoffController
 */

import { HandoffError } from "./handoff-error.js";
import type {
  ControlOwner,
  HandoffController,
  InterventionRequest,
} from "./handoff-types.js";
import { validateInterventionRequest } from "./validate-intervention.js";

/**
 * In-process handoff. Tests call {@link signalResume} instead of blocking on stdin.
 *
 * One controller maps to one live session. Nested `request` is rejected so the
 * pending intervention cannot be overwritten while a human already owns control.
 */
export class SessionHandoffController implements HandoffController {
  private currentOwner: ControlOwner = "automation";
  /** Intervention that transferred control; cleared on resume so logs stay current. */
  private pending: InterventionRequest | undefined;
  /** Resolvers parked in {@link waitForResume}; drained by {@link signalResume}. */
  private resumeWaiters: Array<() => void> = [];

  /**
   * Who currently may issue automation actions.
   *
   * @returns `"human"` while HITL owns the headed session
   */
  owner(): ControlOwner {
    return this.currentOwner;
  }

  /**
   * The intervention that transferred control, if a human currently owns the session.
   *
   * @returns The pending request, or `undefined` when automation owns control
   */
  currentIntervention(): InterventionRequest | undefined {
    return this.pending;
  }

  /**
   * Transfer control to a human. Automation must not execute until resume.
   *
   * The headed session stays open. This only flips ownership; {@link takeOverBrowser}
   * is what pauses Playwright and waits for ENTER.
   *
   * @param intervention - Operator context; must already pass {@link validateInterventionRequest}
   * @throws {HandoffError} When a human already owns the session (`HUMAN_HAS_CONTROL`)
   */
  async request(intervention: InterventionRequest): Promise<void> {
    validateInterventionRequest(intervention);
    if (this.currentOwner === "human") {
      throw new HandoffError("Human already has control.", "HUMAN_HAS_CONTROL");
    }
    this.pending = intervention;
    this.currentOwner = "human";
  }

  /**
   * Wait until {@link signalResume} returns control to automation.
   *
   * Park here rather than polling `owner()` so CLI ENTER and tests share one
   * resume path. Calling this while automation already owns would hang forever,
   * so we throw instead.
   *
   * @throws {HandoffError} When automation already owns the session
   */
  async waitForResume(): Promise<void> {
    if (this.currentOwner === "automation") {
      throw new HandoffError(
        "Automation already has control.",
        "AUTOMATION_HAS_CONTROL",
      );
    }
    await new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }

  /**
   * Return control to automation. Safe to call from tests without stdin.
   *
   * Drain waiters after flipping owner so a waiter that re-checks `owner()`
   * already sees `"automation"`.
   *
   * @throws {HandoffError} When a human does not currently own the session
   */
  signalResume(): void {
    if (this.currentOwner !== "human") {
      throw new HandoffError("Human does not have control.", "AUTOMATION_HAS_CONTROL");
    }
    this.currentOwner = "automation";
    this.pending = undefined;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Throw when a human owns the session so callers skip Surface.execute.
   *
   * Fail closed at the execute seam: a missed `owner()` check must not click.
   *
   * @throws {HandoffError} With code `HUMAN_HAS_CONTROL`
   */
  assertAutomation(): void {
    if (this.currentOwner !== "automation") {
      throw new HandoffError(
        "automation is paused; human owns the session",
        "HUMAN_HAS_CONTROL",
      );
    }
  }
}
