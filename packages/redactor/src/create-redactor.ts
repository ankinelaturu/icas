/**
 * @file createRedactor — construct a Redactor from a packaged profile name.
 */

import type { RedactionProfileName } from "./redaction-profiles.js";
import { redactionProfile } from "./redaction-profiles.js";
import { Redactor } from "./redactor.js";

/**
 * Build a {@link Redactor} for the packaged `model`, `evidence`, or `terminal` profile.
 */
export function createRedactor(name: RedactionProfileName): Redactor {
  return new Redactor(redactionProfile(name));
}
