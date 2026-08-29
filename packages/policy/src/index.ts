/**
 * @file @icas/policy — prompt-policy loading and runtime PolicyGuard.
 */

export type {
  PolicyCheckContext,
  PolicyDecision,
  RuntimePolicy,
} from "./policy-types.js";
export { dangerousActionReason, collectActionText } from "./action-text.js";
export {
  defaultPromptPolicyPath,
  loadPromptPolicy,
  resolvePromptPolicyPath,
} from "./load-prompt-policy.js";
