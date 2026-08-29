/**
 * @file recoverable — known interstitials that replay may dismiss and retry.
 *
 * These are environmental, not semantic mismatches. Replay retries only after
 * dismissing this copy; a wrong screen stays {@link ReplayFailureCode.preconditionFailed}.
 */

/**
 * Visible strings treated as recoverable waits on the synthetic bank fixture.
 */
export const INTERSTITIAL_TEXTS = [
  "Please wait",
  "Session warning",
  "Temporary application error",
] as const;

/**
 * Control used to dismiss a known interstitial.
 *
 * Ranked `visibleText: Continue` matches the fixture button. Policy still
 * sees this click before execute.
 */
export const INTERSTITIAL_CONTINUE: {
  type: "click";
  target: { strategies: [{ type: "visibleText"; text: "Continue" }] };
} = {
  type: "click",
  target: { strategies: [{ type: "visibleText", text: "Continue" }] },
};
