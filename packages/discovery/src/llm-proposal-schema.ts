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
  llmTargetToDescriptor,
  LlmCapabilityActionSchema,
  LlmTargetDescriptorSchema,
  PossibleOutcomeSchema,
} from "@icas/capability";
import * as z from "zod";

import {
  CandidateValidationError,
  validateCandidateProposal,
  type CandidateProposal,
  type DiscoverySuccessResult,
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
 * One success signal without assertion `oneOf`. Unused field is null.
 */
export const LlmSuccessSignalSchema = z.strictObject({
  type: z.enum(["textVisible", "urlMatches"]),
  value: z.string().nullable(),
  pattern: z.string().nullable(),
});

/**
 * One declared output. `source` is the same target shape as a read action.
 */
export const LlmDeclaredOutputSchema = z.strictObject({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  description: z.string().nullable(),
  source: LlmTargetDescriptorSchema,
});

/**
 * Success-turn contract. Null when status is continue or stuck.
 */
export const LlmDiscoveryResultSchema = z
  .strictObject({
    successSignals: z.array(LlmSuccessSignalSchema),
    outputs: z.array(LlmDeclaredOutputSchema),
  })
  .nullable();

/**
 * Structured output schema passed to Mastra `generate`.
 */
export const LlmCandidateProposalSchema = z.strictObject({
  status: z.enum(["continue", "success", "stuck"]),
  candidates: z.array(LlmCandidateActionSchema),
  rationale: z.string().nullable(),
  result: LlmDiscoveryResultSchema,
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
  const result = mapLlmDiscoveryResult(llm.result);
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
    ...(result === undefined ? {} : { result }),
  };
  return validateCandidateProposal(mapped);
}

/**
 * Map nullable flat `result` onto catalog {@link DiscoverySuccessResult}.
 *
 * @param raw - LLM result or null
 * @returns Catalog result, or undefined when the model sent null
 * @throws {CandidateValidationError} When a signal is missing its required field
 */
function mapLlmDiscoveryResult(
  raw: z.infer<typeof LlmDiscoveryResultSchema>,
): DiscoverySuccessResult | undefined {
  if (raw === null) {
    return undefined;
  }
  return {
    successSignals: raw.successSignals.map((signal, index) => mapLlmSuccessSignal(signal, index)),
    outputs: raw.outputs.map((output) => ({
      name: output.name,
      type: output.type,
      ...(output.description === null || output.description.length === 0
        ? {}
        : { description: output.description }),
      extract: { target: llmTargetToDescriptor(output.source, "read") },
    })),
  };
}

/**
 * Require `value` for textVisible and `pattern` for urlMatches.
 *
 * @param signal - Flat signal
 * @param index - Array index for the Zod path
 */
function mapLlmSuccessSignal(
  signal: z.infer<typeof LlmSuccessSignalSchema>,
  index: number,
): DiscoverySuccessResult["successSignals"][number] {
  if (signal.type === "textVisible") {
    if (signal.value === null || signal.value.length === 0) {
      throw new CandidateValidationError(
        issue("successSignals", index, "textVisible requires value"),
      );
    }
    return { type: "textVisible", value: signal.value };
  }
  if (signal.pattern === null || signal.pattern.length === 0) {
    throw new CandidateValidationError(
      issue("successSignals", index, "urlMatches requires pattern"),
    );
  }
  return { type: "urlMatches", pattern: signal.pattern };
}

/**
 * Build a ZodError so mapping failures share {@link CandidateValidationError}.
 *
 * @param key - Field name
 * @param index - Array index
 * @param message - Why mapping failed
 */
function issue(key: string, index: number, message: string): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      path: ["result", key, index],
      message,
    },
  ]);
}
