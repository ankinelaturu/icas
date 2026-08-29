/**
 * @file Reconstruct the executable discovery path from an append-only trace.
 *
 * Failed branches stay in evidence. `backtrack` pops the last executed action;
 * `chosen_action` without a following ok `action_result` is never compiled.
 */

import {
  CapabilityActionSchema,
  type CapabilityAction,
} from "@icas/capability";

import type { DiscoveryTraceEvent } from "./discovery-types.js";

/**
 * One kept action on the success path, plus optional model expectation.
 */
export interface SuccessfulPathStep {
  action: CapabilityAction;
  expectation?: string;
  rationale?: string;
}

/**
 * Walk the trace with a stack: execute-ok pushes; backtrack pops.
 */
export function extractSuccessfulPath(
  events: readonly DiscoveryTraceEvent[],
): SuccessfulPathStep[] {
  const stack: SuccessfulPathStep[] = [];
  let pending: SuccessfulPathStep | undefined;

  for (const event of events) {
    if (event.type === "chosen_action") {
      pending = parseChosenAction(event.payload);
      continue;
    }
    if (event.type === "action_result") {
      if (pending !== undefined && actionSucceeded(event.payload)) {
        stack.push(pending);
      }
      pending = undefined;
      continue;
    }
    if (event.type === "backtrack") {
      stack.pop();
      pending = undefined;
    }
  }

  return stack;
}

function parseChosenAction(payload: unknown): SuccessfulPathStep | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as {
    action?: unknown;
    expectation?: unknown;
    rationale?: unknown;
  };
  const parsed = CapabilityActionSchema.safeParse(record.action);
  if (!parsed.success) {
    return undefined;
  }
  const step: SuccessfulPathStep = { action: parsed.data };
  if (typeof record.expectation === "string" && record.expectation.length > 0) {
    step.expectation = record.expectation;
  }
  if (typeof record.rationale === "string" && record.rationale.length > 0) {
    step.rationale = record.rationale;
  }
  return step;
}

function actionSucceeded(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") {
    return false;
  }
  return (payload as { status?: unknown }).status === "ok";
}
