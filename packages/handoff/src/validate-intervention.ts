/**
 * @file validate-intervention — required InterventionRequest fields.
 */

import { HandoffError } from "./handoff-error.js";
import {
  INTERVENTION_REASONS,
  type InterventionRequest,
} from "./handoff-types.js";

/**
 * Reject an intervention that is missing required operator context.
 *
 * @throws {HandoffError} When `runId`, `reason`, or `message` is missing or empty
 */
export function validateInterventionRequest(request: InterventionRequest): void {
  if (request.runId.trim().length === 0) {
    throw new HandoffError("InterventionRequest.runId is required.", "INVALID_INTERVENTION");
  }
  if (request.message.trim().length === 0) {
    throw new HandoffError(
      "InterventionRequest.message is required.",
      "INVALID_INTERVENTION",
    );
  }
  if (!INTERVENTION_REASONS.includes(request.reason)) {
    throw new HandoffError(
      "InterventionRequest.reason is not a known intervention reason.",
      "INVALID_INTERVENTION",
    );
  }
}
