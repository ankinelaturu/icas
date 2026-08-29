/**
 * @file SessionHandoffController — automation/human ownership for one live session.
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
 */
export class SessionHandoffController implements HandoffController {
  private currentOwner: ControlOwner = "automation";
  private pending: InterventionRequest | undefined;
  private resumeWaiters: Array<() => void> = [];

  /**
   * Who currently may issue automation actions.
   */
  owner(): ControlOwner {
    return this.currentOwner;
  }

  /**
   * The intervention that transferred control, if a human currently owns the session.
   */
  currentIntervention(): InterventionRequest | undefined {
    return this.pending;
  }

  /**
   * Transfer control to a human. Automation must not execute until resume.
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
