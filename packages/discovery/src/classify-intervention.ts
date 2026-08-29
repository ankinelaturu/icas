/**
 * @file Classify discovery HITL so only recurring approvals become capability steps.
 *
 * Exceptional recovery stays in the JSONL evidence. Replay must not pause for a
 * one-off policy block or a stuck search that a human already resolved.
 */

/**
 * Recurring approval boundaries compile to `handoff`. Exceptional recovery
 * (policy block, stuck search, one-off manual repair) stays in the trace.
 *
 * @param reason - Intervention reason recorded on the discovery trace
 * @returns `handoff` only for `approval_required`; everything else is evidence
 */
export function classifyHumanIntervention(
  reason: string,
): "handoff" | "evidence" {
  // Replay needs a durable pause at the same approval boundary.
  // policy_block and discovery_stuck are one-off recoveries, not reusable steps.
  if (reason === "approval_required") {
    return "handoff";
  }
  return "evidence";
}
