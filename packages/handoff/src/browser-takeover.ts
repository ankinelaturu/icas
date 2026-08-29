/**
 * @file browser-takeover — pause the live session, wait for ENTER, record before/after evidence.
 */

import type { EvidenceWriter, RunType } from "@icas/evidence";
import type { Observation } from "@icas/surface";

import { readStdinLine } from "./cli-prompt.js";
import type { InterventionRequest } from "./handoff-types.js";
import type { SessionHandoffController } from "./session-handoff-controller.js";

/**
 * Surface methods required to pause, observe, and resume the same session.
 */
export interface TakeoverSurface {
  observe(): Promise<Observation>;
  handoffToHuman(): Promise<void>;
  resumeFromHuman(): Promise<void>;
}

/**
 * Options for a headed-session control transfer.
 */
export interface BrowserTakeoverOptions {
  surface: TakeoverSurface;
  handoff: SessionHandoffController;
  evidence: EvidenceWriter;
  stdin: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  intervention: InterventionRequest;
  runType: RunType;
}

/**
 * Transfer the live session to a human, wait for ENTER, then resume automation.
 *
 * Records handoff start/end and observations before and after. Does not compile
 * human actions into a capability.
 */
export async function takeOverBrowser(options: BrowserTakeoverOptions): Promise<void> {
  const { surface, handoff, evidence, intervention, runType } = options;
  const runId = intervention.runId;
  const now = (): string => new Date().toISOString();

  await evidence.append({
    timestamp: now(),
    runId,
    runType,
    type: "handoff_start",
    actor: "human",
    payload: { reason: intervention.reason, message: intervention.message },
  });

  const before = await surface.observe();
  await evidence.append({
    timestamp: now(),
    runId,
    runType,
    type: "observation",
    actor: "human",
    payload: { phase: "before", observation: before },
  });

  await handoff.request(intervention);
  await surface.handoffToHuman();

  const resumed = handoff.waitForResume();
  await readStdinLine(
    "Automation is paused. Use the existing browser window, then press ENTER here when finished.\n",
    options,
  );
  await evidence.append({
    timestamp: now(),
    runId,
    runType,
    type: "resume_signal",
    actor: "human",
  });
  handoff.signalResume();
  await resumed;
  await surface.resumeFromHuman();

  const after = await surface.observe();
  await evidence.append({
    timestamp: now(),
    runId,
    runType,
    type: "observation",
    actor: "human",
    payload: { phase: "after", observation: after },
  });
  await evidence.append({
    timestamp: now(),
    runId,
    runType,
    type: "handoff_end",
    actor: "human",
  });
}
