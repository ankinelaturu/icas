/**
 * @file Match compiled possibleOutcomes against visible page text.
 *
 * Replay owns this scan, not discover. Skip `kind: "success"`: the next
 * step's locator is how the happy path continues. Within one outcome, any
 * phrase may hit (OR). First hitting remaining entry wins.
 *
 * Read the current view once. Do not `textVisible`-wait per phrase: the
 * document is already settled after the next-locator miss.
 */

import type { PossibleOutcome } from "@icas/capability";
import type { Surface } from "@icas/surface";

/**
 * One catalog entry plus the phrase that was visible.
 */
export interface MatchedPossibleOutcome {
  outcome: PossibleOutcome;
  /** The `match.phrases` entry found in {@link Surface.visibleText}. */
  phrase: string;
}

/**
 * Whether `phrase` appears in already-captured page text.
 *
 * Case-insensitive substring, same family as Playwright `getByText` without
 * `exact`. No wait: the caller already has the current view.
 *
 * @param pageText - `visibleText()` snapshot
 * @param phrase - One catalog phrase
 */
export function pageTextContainsPhrase(pageText: string, phrase: string): boolean {
  if (phrase.length === 0) {
    return false;
  }
  return pageText.toLowerCase().includes(phrase.toLowerCase());
}

/**
 * Walk `outcomes` in order and return the first non-success hit.
 *
 * Missing or empty lists are a miss, not a default domain result. Do not
 * invent product copy here.
 *
 * @param surface - Live session; `visibleText` is read once
 * @param outcomes - Compiled step list; `success` entries are skipped
 * @returns The first hit, or `undefined` when nothing matched
 */
export async function matchPossibleOutcomes(
  surface: Surface,
  outcomes: readonly PossibleOutcome[] | undefined,
): Promise<MatchedPossibleOutcome | undefined> {
  if (outcomes === undefined || outcomes.length === 0) {
    return undefined;
  }
  const pageText = await surface.visibleText();
  for (const outcome of outcomes) {
    // Success is a proposer hint that the goal completed. Locators already
    // encode the happy path after this step.
    if (outcome.kind === "success") {
      continue;
    }
    for (const phrase of outcome.match.phrases) {
      if (pageTextContainsPhrase(pageText, phrase)) {
        return { outcome, phrase };
      }
    }
  }
  return undefined;
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
