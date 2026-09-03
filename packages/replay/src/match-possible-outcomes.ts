/**
 * @file Match compiled possibleOutcomes: read page text, run matcher pipeline.
 *
 * Replay owns this scan, not discover. Matchers skip `kind: "success"`.
 * Read the current view once. Do not `textVisible`-wait per phrase.
 */

import type { PossibleOutcome } from "@icas/capability";
import type { Surface } from "@icas/surface";

import { DEFAULT_OUTCOME_MATCHERS } from "./default-outcome-matchers.js";
import type { MatchedPossibleOutcome, OutcomeMatcher } from "./outcome-matcher.js";
import { runOutcomeMatchers } from "./outcome-matcher.js";

export type { MatchedPossibleOutcome } from "./outcome-matcher.js";
export { pageTextContainsPhrase } from "./substring-outcome-matcher.js";

/**
 * Walk registered matchers against one `visibleText` snapshot.
 *
 * Missing or empty lists are a miss, not a default domain result. All
 * matchers miss → caller continues to generic chrome / UNEXPECTED_STATE.
 *
 * @param surface - Live session; `visibleText` is read once
 * @param outcomes - Compiled step list
 * @param matchers - Default substring then embedding stub; tests may inject
 * @returns The first hit, or `undefined` when nothing matched
 */
export async function matchPossibleOutcomes(
  surface: Surface,
  outcomes: readonly PossibleOutcome[] | undefined,
  matchers: readonly OutcomeMatcher[] = DEFAULT_OUTCOME_MATCHERS,
): Promise<MatchedPossibleOutcome | undefined> {
  if (outcomes === undefined || outcomes.length === 0) {
    return undefined;
  }
  const pageText = await surface.visibleText();
  return runOutcomeMatchers(matchers, { pageText }, outcomes);
}

/**
 * Stable `ExecutionResult.outcome` id from tool copy, not a product enum.
 *
 * @param heading - Nullable catalog heading
 * @param phrase - Phrase that hit
 */
export function outcomeSlug(heading: string | null, phrase: string): string {
  const source = heading ?? phrase;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.length > 0 ? slug : "business_outcome";
}
