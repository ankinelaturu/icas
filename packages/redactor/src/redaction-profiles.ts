/**
 * @file Named redaction profiles for model, evidence, and terminal boundaries.
 */

import type { RedactionProfile } from "./redactor.js";

/**
 * Which persistence/egress boundary a {@link Redactor} is configured for.
 */
export type RedactionProfileName = "model" | "evidence" | "terminal";

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ACCOUNT = /\b\d{10,12}\b/g;

/**
 * Masks identifiers that must not be sent to a model.
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
 */
export function redactionProfile(name: RedactionProfileName): RedactionProfile {
  return PROFILES[name];
}
