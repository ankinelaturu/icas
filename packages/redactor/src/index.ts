/**
 * @file @icas/redactor — independently configurable redaction profiles.
 */

export type { RedactionProfile, RedactionRule } from "./redactor.js";
export { Redactor } from "./redactor.js";
export type { RedactionProfileName } from "./redaction-profiles.js";
export {
  EVIDENCE_PROFILE,
  MODEL_PROFILE,
  TERMINAL_PROFILE,
  redactionProfile,
} from "./redaction-profiles.js";
export { createRedactor } from "./create-redactor.js";
