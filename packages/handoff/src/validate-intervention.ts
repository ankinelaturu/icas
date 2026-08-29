/**
 * @file validate-intervention — required InterventionRequest fields.
 *
 * An operator should act without reconstructing the run. Empty `runId` or
 * `message` would produce a pause with no usable context, so we fail closed.
 *
 * @see InterventionRequest
 */

import { HandoffError } from "./handoff-error.js";
import {
  INTERVENTION_REASONS,
  type InterventionRequest,
} from "./handoff-types.js";

/**
 * Reject an intervention that is missing required operator context.
 *
 * `reason` must be a known {@link InterventionReason} so evidence can group
 * HITL by cause (policy block vs stuck discovery) instead of free text.
 *
 * @param request - Proposed control transfer
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
