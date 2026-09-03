/**
 * @file Default possibleOutcomes pipeline: substring, then embedding stub.
 *
 * Register more matchers by appending to a copy; do not reorder cheap ranks
 * after expensive ones.
 */

import { EmbeddingOutcomeMatcher } from "./embedding-outcome-matcher.js";
import type { OutcomeMatcher } from "./outcome-matcher.js";
import { SubstringOutcomeMatcher } from "./substring-outcome-matcher.js";

/**
 * Built-in ranks. Substring first so a visible banner does not wait on
 * embeddings. The stub never hits; later Pass 4.15 fills that class.
 */
export const DEFAULT_OUTCOME_MATCHERS: readonly OutcomeMatcher[] = [
  new SubstringOutcomeMatcher(),
  new EmbeddingOutcomeMatcher(),
];
