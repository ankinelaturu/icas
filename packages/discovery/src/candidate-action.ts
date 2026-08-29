/**
 * @file CandidateAction — schema-validated LLM output for one discovery state.
 *
 * The model must return {@link CandidateProposalSchema}, never free-form prose.
 * Ranking is the useful property; numeric confidence is not a calibrated probability.
 */

import { CapabilityActionSchema, type CapabilityAction } from "@icas/capability";
import { z } from "zod";

/**
 * One ranked UI action proposed from the current observation.
 *
 * `rank` 1 is tried before `rank` 2 (confidence-ordered DFS).
 */
export const CandidateActionSchema = z.strictObject({
  // ICAS assigns this when omitted so DFS can mark tried siblings without
  // storing graph state in the proposer's conversation memory.
  id: z.string().min(1).optional(),
  action: CapabilityActionSchema,
  rationale: z.string().min(1),
  // Lowest number is tried first. Not a calibrated probability.
  rank: z.number(),
  // Visible text the model expects after execute; compiler turns this into checkpoints.
  expectation: z.string().min(1).optional(),
  // Optional hint for PolicyGuard (risky → require-human). Not a search ranking.
  risk: z.enum(["safe", "risky"]).optional(),
});

/**
 * Required LLM response for every proposer call.
 *
 * - `continue` — ICAS should try `candidates` in rank order
 * - `success` — the goal is already satisfied on this observation
 * - `stuck` — do not improvise; request human intervention
 *
 * `candidates` may be empty only when `status` is `success` or `stuck`.
 */
export const CandidateProposalSchema = z
  .strictObject({
    status: z.enum(["continue", "success", "stuck"]),
    candidates: z.array(CandidateActionSchema),
    // Optional on success/stuck so the model can explain without extra candidates.
    rationale: z.string().min(1).optional(),
  })
  .superRefine((proposal, ctx) => {
    // continue with zero candidates would exhaust the node immediately and
    // look like a model-declared stuck without an explicit stuck status.
    if (proposal.status === "continue" && proposal.candidates.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "status continue requires at least one candidate",
      });
    }
  });

export type CandidateAction = z.infer<typeof CandidateActionSchema>;
export type CandidateProposal = z.infer<typeof CandidateProposalSchema>;

/**
 * Thrown when model output does not match {@link CandidateProposalSchema}.
 *
 * Callers catch this type instead of depending on Zod's error class.
 */
export class CandidateValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  /**
   * @param error - Zod failure from {@link CandidateProposalSchema}
   */
  constructor(error: z.ZodError) {
    super(`Invalid candidate proposal: ${z.prettifyError(error)}`);
    this.name = "CandidateValidationError";
    this.issues = error.issues;
  }
}

/**
 * Schema-validate unknown proposer JSON.
 *
 * @param value - Parsed model output (object, not a transcript string)
 * @returns Typed proposal
 * @throws {CandidateValidationError} When the payload is free-form or malformed
 */
export function validateCandidateProposal(value: unknown): CandidateProposal {
  const result = CandidateProposalSchema.safeParse(value);
  // Wrap Zod so discovery callers catch CandidateValidationError, not a Zod type.
  if (!result.success) {
    throw new CandidateValidationError(result.error);
  }
  return result.data;
}

/**
 * Assign stable ids so DFS can record tried branches without conversation memory.
 *
 * @param candidates - Ranked siblings from one proposer call
 * @returns The same actions, with an `id` on every element
 */
export function assignCandidateIds(
  candidates: CandidateAction[],
): CandidateAction[] {
  return candidates.map((candidate, index) => {
    // Preserve a model-supplied id so traces stay stable across retries.
    if (candidate.id !== undefined) {
      return candidate;
    }
    return {
      ...candidate,
      id: `cand-${String(candidate.rank)}-${String(index)}`,
    };
  });
}

/**
 * Lowest rank first (try highest-confidence untried sibling first).
 *
 * Copies the array so the proposer's return value stays untouched.
 *
 * @param candidates - Unordered or model-ordered siblings
 * @returns New array, rank ascending
 */
export function sortCandidatesByRank(
  candidates: CandidateAction[],
): CandidateAction[] {
  return [...candidates].sort((a, b) => a.rank - b.rank);
}

export type { CapabilityAction };
