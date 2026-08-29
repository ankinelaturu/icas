/**
 * @file Named redaction profiles for model, evidence, and terminal boundaries.
 *
 * PolicyGuard does not embed these rules. Each boundary chooses what it is
 * willing to leak: the model may need an email to fill a form; disk must not
 * keep one.
 *
 * @see Redactor
 * @see createRedactor
 */

import type { RedactionProfile } from "./redactor.js";

/**
 * Which persistence/egress boundary a {@link Redactor} is configured for.
 *
 * `evidence` is the strictest because files outlive the process.
 */
export type RedactionProfileName = "model" | "evidence" | "terminal";

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ACCOUNT = /\b\d{10,12}\b/g;

/**
 * Masks identifiers that must not be sent to a model.
 *
 * Omits email so discovery can still fill address fields. SSN and account
 * numbers must never be echoed back in a proposed action.
 */
export const MODEL_PROFILE: RedactionProfile = {
  name: "model",
  rules: [
    { id: "ssn", pattern: SSN, replacement: "[MODEL_SSN]" },
    { id: "account", pattern: ACCOUNT, replacement: "[MODEL_ACCOUNT]" },
  ],
};

/**
 * Masks identifiers that must not be persisted on disk.
 *
 * Evidence is the leak that reviewers and CI will copy. Email is included
 * here even though the model profile leaves it.
 */
export const EVIDENCE_PROFILE: RedactionProfile = {
  name: "evidence",
  rules: [
    { id: "ssn", pattern: SSN, replacement: "[REDACTED_SSN]" },
    { id: "email", pattern: EMAIL, replacement: "[REDACTED_EMAIL]" },
    { id: "account", pattern: ACCOUNT, replacement: "[REDACTED_ACCOUNT]" },
  ],
};

/**
 * Masks identifiers in operator-facing terminal output.
 *
 * HITL operators may need to see an email to complete a form; they must not
 * see SSN or account numbers in the CLI.
 */
export const TERMINAL_PROFILE: RedactionProfile = {
  name: "terminal",
  rules: [
    { id: "ssn", pattern: SSN, replacement: "[SSN]" },
    { id: "account", pattern: ACCOUNT, replacement: "[ACCOUNT]" },
  ],
};

const PROFILES: Record<RedactionProfileName, RedactionProfile> = {
  model: MODEL_PROFILE,
  evidence: EVIDENCE_PROFILE,
  terminal: TERMINAL_PROFILE,
};

/**
 * Return the packaged profile for `name`.
 *
 * Callers should not clone and edit these objects at runtime; add a profile
 * in this module instead so every boundary stays reviewable in one file.
 *
 * @param name - `model`, `evidence`, or `terminal`
 * @returns The packaged rule set for that boundary
 */
export function redactionProfile(name: RedactionProfileName): RedactionProfile {
  return PROFILES[name];
}
