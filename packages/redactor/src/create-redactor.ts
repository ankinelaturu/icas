/**
 * @file createRedactor — construct a Redactor from a packaged profile name.
 *
 * Callers name a boundary (`model` / `evidence` / `terminal`) instead of
 * assembling regexes. Evidence writers must use `"evidence"` so persist
 * cannot silently share the weaker model profile.
 *
 * @see redactionProfile
 */

import type { RedactionProfileName } from "./redaction-profiles.js";
import { redactionProfile } from "./redaction-profiles.js";
import { Redactor } from "./redactor.js";

/**
 * Build a {@link Redactor} for the packaged `model`, `evidence`, or `terminal` profile.
 *
 * @param name - Egress boundary this instance will mask
 * @returns A redactor bound to that packaged rule set
 */
export function createRedactor(name: RedactionProfileName): Redactor {
  return new Redactor(redactionProfile(name));
}
