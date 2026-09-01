/**
 * @file Runtime generic error chrome — not stored on the capability.
 *
 * Step `possibleOutcomes` are goal-specific guesses and always win. This list
 * is a last-resort scan of distinctive infrastructure copy after that miss.
 * Do not merge it into discover instructions or compiled steps.
 */

import type { PossibleOutcome } from "@icas/capability";

/**
 * Tiny fixed catalog of visible chrome. Phrases are multi-word on purpose.
 */
export const GENERIC_CHROME_OUTCOMES: readonly PossibleOutcome[] = [
  {
    kind: "error",
    match: { phrases: ["Internal Server Error"] },
    heading: "Internal Server Error",
    summary: "The server returned a generic error page.",
  },
  {
    kind: "error",
    match: { phrases: ["Access Denied"] },
    heading: "Access Denied",
    summary: "The application refused access to this screen.",
  },
  {
    kind: "error",
    match: { phrases: ["404 Not Found"] },
    heading: "Not Found",
    summary: "The page text reports that the document was not found.",
  },
];
