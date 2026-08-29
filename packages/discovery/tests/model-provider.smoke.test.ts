/**
 * @file Optional live discovery smoke. Skipped unless ICAS_DISCOVERY_SMOKE=1 and a key exists.
 */

import { describe, expect, it } from "vitest";

import { createConfiguredDiscoveryProposer } from "../src/mastra-proposer.js";
import {
  discoverySmokeEnabled,
  hasDiscoveryApiKey,
} from "../src/model-provider.js";

const live = discoverySmokeEnabled() && hasDiscoveryApiKey();

describe("discovery live smoke", () => {
  it.skipIf(!live)("generate returns a CandidateProposal from the configured model", async () => {
    const { proposer } = await createConfiguredDiscoveryProposer();
    const proposal = await proposer.propose({
      goal: "Generate a payoff statement",
      observation: { id: "home", url: "http://localhost:4101/" },
      history: [],
    });
    expect(["continue", "success", "stuck"]).toContain(proposal.status);
  });
});
