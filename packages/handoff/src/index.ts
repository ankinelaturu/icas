/**
 * @file @icas/handoff — HITL on the same headed session, not co-browsing.
 *
 * CLI approval/value prompts and browser takeover both record `actor: "human"`.
 * {@link SessionHandoffController} is the ownership seam callers must honor
 * before Surface.execute.
 */

export type {
  ControlOwner,
  HandoffController,
  InterventionReason,
  InterventionRequest,
} from "./handoff-types.js";
export { INTERVENTION_REASONS } from "./handoff-types.js";
export { HandoffError } from "./handoff-error.js";
export { validateInterventionRequest } from "./validate-intervention.js";
export { SessionHandoffController } from "./session-handoff-controller.js";
export { promptForApproval, promptForValue, readStdinLine } from "./cli-prompt.js";
export type { CliPromptOptions } from "./cli-prompt.js";
export { takeOverBrowser } from "./browser-takeover.js";
export type {
  BrowserTakeoverOptions,
  TakeoverSurface,
} from "./browser-takeover.js";
