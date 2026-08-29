/**
 * @file HITL resume over stdin for the same headed Playwright session.
 *
 * ReplayEngine parks on {@link HandoffController.waitForResume}. This adapter
 * waits for ENTER, then {@link SessionHandoffController.signalResume}. It is
 * not a co-browsing console.
 */

import { readStdinLine, SessionHandoffController } from "@icas/handoff";
import type { HandoffController, InterventionRequest } from "@icas/handoff";

/**
 * Wrap {@link SessionHandoffController} so `waitForResume` reads ENTER.
 *
 * Tests that must not block stdin inject `executeReplay` instead.
 */
export class CliHandoffController implements HandoffController {
  private readonly inner = new SessionHandoffController();

  constructor(
    private readonly io: {
      stdin: NodeJS.ReadableStream;
      stdout?: NodeJS.WritableStream;
    },
  ) {}

  /**
   * @returns Current ownership of the live session
   */
  owner(): ReturnType<SessionHandoffController["owner"]> {
    return this.inner.owner();
  }

  /**
   * Flip ownership to human. ReplayEngine calls this before waiting.
   *
   * @param intervention - Why automation paused
   */
  async request(intervention: InterventionRequest): Promise<void> {
    await this.inner.request(intervention);
  }

  /**
   * Block until the operator presses ENTER, then return control to automation.
   *
   * Do not call the inner `waitForResume` after `signalResume` — that would
   * throw because ownership is already automation.
   */
  async waitForResume(): Promise<void> {
    const pending = this.inner.currentIntervention();
    const reason = pending?.message ?? "human intervention required";
    await readStdinLine(
      `HITL: ${reason}. Press ENTER to resume automation.\n`,
      { stdin: this.io.stdin, ...(this.io.stdout === undefined ? {} : { stdout: this.io.stdout }) },
    );
    this.inner.signalResume();
  }
}
