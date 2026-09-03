/**
 * @file EmbeddingOutcomeMatcher — stub for later phrase embeddings (Pass 4.15).
 *
 * Intended later: chunk `pageText`, embed chunks and `match.phrases`, return
 * a high-confidence phrase. Strict replay stays local (no LLM). Do not store
 * vectors on the capability. Until that lands, always miss so substring and
 * UNEXPECTED_STATE keep working.
 */

import type { PossibleOutcome } from "@icas/capability";

import type {
  MatchedPossibleOutcome,
  OutcomeMatchContext,
  OutcomeMatcher,
} from "./outcome-matcher.js";

/**
 * Second pipeline rank. Always returns no hit.
 */
export class EmbeddingOutcomeMatcher implements OutcomeMatcher {
  readonly id = "embedding";

  /**
   * Reserved for chunk + embed + similarity. Fail closed.
   *
   * @param _context - Page snapshot (unused until Pass 4.15)
   * @param _outcomes - Compiled guesses (unused until Pass 4.15)
   * @returns Always `undefined`
   */
  match(
    _context: OutcomeMatchContext,
    _outcomes: readonly PossibleOutcome[],
  ): MatchedPossibleOutcome | undefined {
    return undefined;
  }
}
