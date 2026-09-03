/**
 * @file Ordered possibleOutcomes matchers — cheap first, optional later ranks.
 *
 * Replay reads page text once, then runs registered matchers until one hits.
 * All miss → the engine continues to generic chrome, then UNEXPECTED_STATE.
 * Do not store embeddings on the capability.
 */

import type { PossibleOutcome } from "@icas/capability";

/**
 * One catalog entry plus the phrase the matcher selected.
 */
export interface MatchedPossibleOutcome {
  outcome: PossibleOutcome;
  /** Phrase from `match.phrases` (or a later matcher’s chosen wording). */
  phrase: string;
}

/**
 * Snapshot the pipeline shares. Matchers must not wait on the surface.
 */
export interface OutcomeMatchContext {
  /** `Surface.visibleText()` of the current view. */
  pageText: string;
}

/**
 * One rank in the outcome pipeline.
 *
 * Skip `kind: "success"`. Within an outcome, phrases are OR. First hitting
 * remaining outcome wins for this matcher.
 */
export interface OutcomeMatcher {
  /** Stable id for tests and logs (`substring`, `embedding`, …). */
  readonly id: string;
  /**
   * Classify `outcomes` against `context`.
   *
   * @returns A hit, or `undefined` so the next matcher may run
   */
  match(
    context: OutcomeMatchContext,
    outcomes: readonly PossibleOutcome[],
  ): MatchedPossibleOutcome | undefined;
}

/**
 * Run `matchers` in order. First hit wins.
 *
 * @param matchers - Cheap ranks first
 * @param context - Shared page snapshot
 * @param outcomes - Compiled list; empty is a miss
 */
export function runOutcomeMatchers(
  matchers: readonly OutcomeMatcher[],
  context: OutcomeMatchContext,
  outcomes: readonly PossibleOutcome[],
): MatchedPossibleOutcome | undefined {
  if (outcomes.length === 0) {
    return undefined;
  }
  for (const matcher of matchers) {
    const hit = matcher.match(context, outcomes);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}
