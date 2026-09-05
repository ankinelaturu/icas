/**
 * @file SubstringOutcomeMatcher — case-insensitive phrase scan of page text.
 *
 * First pipeline rank: cheap, no model. Same family as Playwright `getByText`
 * without `exact`.
 */

import type { PossibleOutcome } from "@icas/capability";

import type {
  MatchedPossibleOutcome,
  OutcomeMatchContext,
  OutcomeMatcher,
} from "./outcome-matcher.js";

/**
 * Whether `phrase` appears in already-captured page text.
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
 * First matcher: substring of the current view.
 */
export class SubstringOutcomeMatcher implements OutcomeMatcher {
  readonly id = "substring";

  /**
   * Walk outcomes in order. Skip success. Any phrase may hit (OR).
   *
   * @param context - Page snapshot
   * @param outcomes - Compiled guesses
   */
  match(
    context: OutcomeMatchContext,
    outcomes: readonly PossibleOutcome[],
  ): MatchedPossibleOutcome | undefined {
    for (const outcome of outcomes) {
      // Compiler strips success, but skip anyway so a stale catalog entry
      // cannot look like an error hit.
      if (outcome.kind === "success") {
        continue;
      }
      for (const phrase of outcome.match.phrases) {
        if (pageTextContainsPhrase(context.pageText, phrase)) {
          return { outcome, phrase };
        }
      }
    }
    return undefined;
  }
}
