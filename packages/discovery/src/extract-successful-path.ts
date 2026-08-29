/**
 * @file Reconstruct the executable discovery path from an append-only trace.
 *
 * Failed branches stay in evidence. `backtrack` pops the last executed action;
 * `chosen_action` without a following ok `action_result` is never compiled.
 * Recurring approval inserts a `handoff` step; exceptional HITL does not.
 */

import {
  CapabilityActionSchema,
  type CapabilityAction,
} from "@icas/capability";

import { classifyHumanIntervention } from "./classify-intervention.js";
import type { DiscoveryTraceEvent } from "./discovery-types.js";

export interface PathObservation {
  id: string;
  url?: string;
}

/**
 * One kept action on the success path, plus optional model expectation.
 */
export interface SuccessfulPathStep {
  action: CapabilityAction;
  expectation?: string;
  rationale?: string;
  before?: PathObservation;
  after?: PathObservation;
  /** Recurring approval to insert as a `handoff` step before this action. */
  insertHandoff?: string;
}

/**
 * Walk the trace with a stack: execute-ok pushes; backtrack pops.
 */
export function extractSuccessfulPath(
  events: readonly DiscoveryTraceEvent[],
): SuccessfulPathStep[] {
  const stack: SuccessfulPathStep[] = [];
  let pending: SuccessfulPathStep | undefined;
  let lastObservation: PathObservation | undefined;

  for (const event of events) {
    if (event.type === "observation") {
      lastObservation = parseObservation(event.payload);
      const top = stack[stack.length - 1];
      if (top !== undefined && top.after === undefined && lastObservation !== undefined) {
        top.after = lastObservation;
      }
      continue;
    }
    if (event.type === "chosen_action") {
      pending = parseChosenAction(event.payload);
      if (pending !== undefined && lastObservation !== undefined) {
        pending.before = lastObservation;
      }
      continue;
    }
    if (event.type === "intervention") {
      const reason = interventionReason(event.payload);
      if (
        pending !== undefined &&
        reason !== undefined &&
        classifyHumanIntervention(reason) === "handoff"
      ) {
        pending.insertHandoff = interventionMessage(event.payload, reason);
      }
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
      const restored = restoreObservation(event.payload);
      if (restored !== undefined) {
        lastObservation = restored;
      }
    }
  }

  return stack;
}

function parseObservation(payload: unknown): PathObservation | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as { id?: unknown; url?: unknown };
  if (typeof record.id !== "string" || record.id.length === 0) {
    return undefined;
  }
  return {
    id: record.id,
    ...(typeof record.url === "string" && record.url.length > 0 ? { url: record.url } : {}),
  };
}

function restoreObservation(payload: unknown): PathObservation | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const to = (payload as { to?: unknown }).to;
  if (typeof to !== "string" || to.length === 0) {
    return undefined;
  }
  return { id: to, url: to };
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

function interventionReason(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

function interventionMessage(payload: unknown, fallback: string): string {
  if (payload !== null && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

function actionSucceeded(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") {
    return false;
  }
  return (payload as { status?: unknown }).status === "ok";
}
