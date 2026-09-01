/**
 * @file OpenAI-safe candidate proposal schema (no JSON Schema oneOf).
 *
 * {@link CandidateProposalSchema} embeds {@link CapabilityActionSchema}
 * discriminated unions, which OpenAI's Responses API rejects. Generate uses
 * this flat schema; {@link llmProposalToCandidateProposal} then validates
 * through the catalog types.
 */

import {
  llmActionToCapabilityAction,
  LlmCapabilityActionSchema,
  PossibleOutcomeSchema,
} from "@icas/capability";
import * as z from "zod";

import {
  CandidateValidationError,
  validateCandidateProposal,
  type CandidateProposal,
} from "./candidate-action.js";

/**
 * One ranked candidate as the model must emit it.
 *
 * Nullable fields stay in the object so OpenAI strict JSON Schema can list
 * every key as required without `oneOf`.
 */
export const LlmCandidateActionSchema = z.strictObject({
  id: z.string().nullable(),
  action: LlmCapabilityActionSchema,
  rationale: z.string().min(1),
  rank: z.number(),
  expectation: z.string().nullable(),
  risk: z.enum(["safe", "risky"]).nullable(),
  // Required key for OpenAI strict JSON Schema; empty array is a valid guess.
  possibleOutcomes: z.array(PossibleOutcomeSchema),
});

/**
 * Structured output schema passed to Mastra `generate`.
 */
export const LlmCandidateProposalSchema = z.strictObject({
  status: z.enum(["continue", "success", "stuck"]),
  candidates: z.array(LlmCandidateActionSchema),
  rationale: z.string().nullable(),
});

export type LlmCandidateProposal = z.infer<typeof LlmCandidateProposalSchema>;

/**
 * Map flat LLM JSON onto {@link CandidateProposal}.
 *
 * @param value - `generate` result object
 * @returns Catalog-shaped proposal
 * @throws {CandidateValidationError} When the mapped object fails catalog validation
 */
export function llmProposalToCandidateProposal(value: unknown): CandidateProposal {
  const parsed = LlmCandidateProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw new CandidateValidationError(parsed.error);
  }
  const llm = parsed.data;
  const mapped = {
    status: llm.status,
    candidates: llm.candidates.map((candidate) => {
      const action = llmActionToCapabilityAction(candidate.action);
      const hint = candidate.action.proposedInputParam;
      return {
        ...(candidate.id === null || candidate.id.length === 0 ? {} : { id: candidate.id }),
        action,
        rationale: candidate.rationale,
        rank: candidate.rank,
        ...(candidate.expectation === null || candidate.expectation.length === 0
          ? {}
          : { expectation: candidate.expectation }),
        ...(candidate.risk === null ? {} : { risk: candidate.risk }),
        possibleOutcomes: candidate.possibleOutcomes,
        // Catalog actions never carry the hint; it stays on the candidate.
        ...(hint === null ? {} : { proposedInputParam: hint }),
      };
    }),
    ...(llm.rationale === null || llm.rationale.length === 0
      ? {}
      : { rationale: llm.rationale }),
  };
  return validateCandidateProposal(mapped);
}
