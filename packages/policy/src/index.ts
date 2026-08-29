/**
 * @file @icas/policy — injectable prompt text plus runtime PolicyGuard.
 *
 * Prompt markdown influences the model. {@link PolicyGuard} allow / deny /
 * require-human is what actually executes. Redaction lives in `@icas/redactor`.
 */

export type {
  PolicyCheckContext,
  PolicyDecision,
  RuntimePolicy,
} from "./policy-types.js";
export { PolicyGuard } from "./policy-guard.js";
export { dangerousActionReason, collectActionText } from "./action-text.js";
export {
  defaultPromptPolicyPath,
  loadPromptPolicy,
  resolvePromptPolicyPath,
} from "./load-prompt-policy.js";
