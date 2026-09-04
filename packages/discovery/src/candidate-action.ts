/**
 * @file CandidateAction — schema-validated LLM output for one discovery state.
 *
 * The model must return {@link CandidateProposalSchema}, never free-form prose.
 * Ranking is the useful property; numeric confidence is not a calibrated probability.
 * Fill/select carry {@link ProposedInputParamSchema} on the candidate, not the action.
 */

import {
  CapabilityActionSchema,
  PossibleOutcomeSchema,
  ProposedInputParamSchema,
  SNAPSHOT_REF_PATTERN,
  TargetDescriptorSchema,
  type CapabilityAction,
} from "@icas/capability";
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
  // Exact visible snapshot text after execute; compiler copies this into
  // textVisible checkpoints. Must not be a narrative or a discovery-time id.
  expectation: z.string().min(1).optional(),
  // Optional hint for PolicyGuard (risky → require-human). Not a search ranking.
  risk: z.enum(["safe", "risky"]).optional(),
  // Guessed exceptional-state matchers. Compile keeps error/hitl only.
  possibleOutcomes: z.array(PossibleOutcomeSchema).optional(),
  // Fill/select only. Compiler aggregates these into artifact inputs.
  proposedInputParam: ProposedInputParamSchema.optional(),
  // Discovery-only Playwright snapshot ref (`e12`). Bind/execute use this;
  // compile copies `action.target` after bind, never this field.
  snapshotRef: z.string().regex(SNAPSHOT_REF_PATTERN).optional(),
})
  .superRefine((candidate, ctx) => {
    const needsHint =
      candidate.action.type === "fill" || candidate.action.type === "select";
    if (needsHint && candidate.proposedInputParam === undefined) {
      // Replay must not bake the discovery literal; the model has to name the param.
      ctx.addIssue({
        code: "custom",
        path: ["proposedInputParam"],
        message: "fill and select require proposedInputParam",
      });
    }
    if (!needsHint && candidate.proposedInputParam !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["proposedInputParam"],
        message: "proposedInputParam is only valid on fill and select",
      });
    }
  });

/**
 * Observed completion chrome. Compile copies these onto artifact `success`.
 * Only `textVisible` and `urlMatches` — not locators and not possibleOutcomes.
 */
export const SuccessSignalSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("textVisible"),
    value: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("urlMatches"),
    pattern: z.string().min(1),
  }),
]);

/**
 * One caller-visible value to extract on later replay.
 */
export const DiscoverySuccessOutputSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, {
    error: "output name must be camelCase",
  }),
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  description: z.string().min(1).optional(),
  extract: z.strictObject({ target: TargetDescriptorSchema }),
  // Discovery-only. Stripped before the success event. Never bound: a value
  // cell's inner text is this run's data, not a reusable locator.
  snapshotRef: z.string().regex(SNAPSHOT_REF_PATTERN).optional(),
});

/**
 * Success-turn contract: proof of completion plus extract locators.
 *
 * Discovery does not execute `read` steps to harvest these values.
 */
export const DiscoverySuccessResultSchema = z.strictObject({
  successSignals: z.array(SuccessSignalSchema).min(1),
  outputs: z.array(DiscoverySuccessOutputSchema),
});

/**
 * Required LLM response for every proposer call.
 *
 * - `continue` — ICAS should try `candidates` in rank order
 * - `success` — the goal is already satisfied; `result` is required
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
    result: DiscoverySuccessResultSchema.optional(),
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
    if (proposal.status === "success" && proposal.result === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: "status success requires result",
      });
    }
    if (proposal.status !== "success" && proposal.result !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: "result is only valid when status is success",
      });
    }
  });

export type CandidateAction = z.infer<typeof CandidateActionSchema>;
export type CandidateProposal = z.infer<typeof CandidateProposalSchema>;
export type DiscoverySuccessResult = z.infer<typeof DiscoverySuccessResultSchema>;
export type DiscoverySuccessOutput = z.infer<typeof DiscoverySuccessOutputSchema>;
export type SuccessSignal = z.infer<typeof SuccessSignalSchema>;

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
