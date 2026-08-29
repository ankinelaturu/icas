/**
 * @file Scripted proposer for discovery tests (no live model).
 */

import type { CandidateProposal } from "../candidate-action.js";
import { validateCandidateProposal } from "../candidate-action.js";
import type { CandidateProposer, ProposeContext } from "../candidate-proposer.js";

/**
 * Returns queued proposals in order. Each entry is schema-validated.
 */
export class FakeProposer implements CandidateProposer {
  private index = 0;

  constructor(private readonly queue: unknown[]) {}

  async propose(_context: ProposeContext): Promise<CandidateProposal> {
    const next = this.queue[this.index];
    this.index += 1;
    if (next === undefined) {
      return { status: "stuck", candidates: [], rationale: "fake proposer exhausted" };
    }
    return validateCandidateProposal(next);
  }
}
