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
  id: z.string().min(1).optional(),
  action: CapabilityActionSchema,
  rationale: z.string().min(1),
  rank: z.number(),
  expectation: z.string().min(1).optional(),
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
    rationale: z.string().min(1).optional(),
  })
  .superRefine((proposal, ctx) => {
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
 */
export class CandidateValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

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
  if (!result.success) {
    throw new CandidateValidationError(result.error);
  }
  return result.data;
}

/**
 * Assign stable ids so DFS can record tried branches without conversation memory.
 */
export function assignCandidateIds(
  candidates: CandidateAction[],
): CandidateAction[] {
  return candidates.map((candidate, index) => {
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
 */
export function sortCandidatesByRank(
  candidates: CandidateAction[],
): CandidateAction[] {
  return [...candidates].sort((a, b) => a.rank - b.rank);
}

export type { CapabilityAction };
