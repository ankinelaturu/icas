/**
 * @file recoverable — known interstitials that replay may dismiss and retry.
 */

export const INTERSTITIAL_TEXTS = [
  "Please wait",
  "Session warning",
  "Temporary application error",
] as const;

/**
 * Control used to dismiss a known interstitial.
 */
export const INTERSTITIAL_CONTINUE: {
  type: "click";
  target: { strategies: [{ type: "visibleText"; text: "Continue" }] };
} = {
  type: "click",
  target: { strategies: [{ type: "visibleText", text: "Continue" }] },
};
