/**
 * @file Classify discovery HITL so only recurring approvals become capability steps.
 */

/**
 * Recurring approval boundaries compile to `handoff`. Exceptional recovery
 * (policy block, stuck search, one-off manual repair) stays in the trace.
 */
export function classifyHumanIntervention(
  reason: string,
): "handoff" | "evidence" {
  if (reason === "approval_required") {
    return "handoff";
  }
  return "evidence";
}
