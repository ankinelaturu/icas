/**
 * @file Minimal success `result` for FakeProposer / schema tests.
 */

import type { DiscoverySuccessResult } from "../../src/candidate-action.js";

/** Goal-complete chrome with no extracted outputs (old-path fallback still works). */
export const MINIMAL_SUCCESS_RESULT: DiscoverySuccessResult = {
  successSignals: [{ type: "textVisible", value: "Payoff Statement is ready" }],
  outputs: [],
};
