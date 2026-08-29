/**
 * @file DiscoveryAgent skeleton tests — fake proposer, no live model.
 */

import { describe, expect, it } from "vitest";

import { PolicyGuard } from "@icas/policy";

import { DiscoveryAgent } from "./discovery-agent.js";
import { FakeProposer } from "./test-support/fake-proposer.js";
import { FakeSurface } from "./test-support/fake-surface.js";

const clickLending = {
  status: "continue" as const,
  candidates: [
    {
      action: {
        type: "click" as const,
        target: {
          strategies: [{ type: "visibleText" as const, text: "Lending" }],
        },
        risk: "safe" as const,
      },
      rationale: "Open lending",
      rank: 1,
    },
  ],
};

const request = {
  id: "loan-payoff",
  goal: "Generate a payoff statement",
  target: {
    vendor: "icas-bank",
    product: "icas-bank",
    tenant: "icas-bank",
    url: "http://localhost:4101/",
  },
};

describe("DiscoveryAgent.run", () => {
  it("always discovers: one successful click then proposer success", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost:4101/" };
    surface.executeHandler = () => {
      surface.observation = { id: "lending", url: "http://localhost:4101/lending.htm" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([clickLending, { status: "success", candidates: [] }]),
      policy: new PolicyGuard({
        allowedOrigins: ["http://localhost:4101"],
        allowedActionTypes: ["click", "fill", "select", "navigate", "read"],
      }),
    });
    const result = await agent.run(request);
    expect(result.status).toBe("success");
    expect(surface.openedUrl).toBe("http://localhost:4101/");
    expect(surface.executed).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual([
      "observation",
      "candidates",
      "chosen_action",
      "policy",
      "action_result",
      "observation",
      "candidates",
      "success",
    ]);
  });

  it("stops on timeout without treating the run as catalog replay", async () => {
    const surface = new FakeSurface();
    let clock = 0;
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([clickLending]),
      now: () => {
        const value = clock;
        clock += 100;
        return value;
      },
    });
    const result = await agent.run({ ...request, timeoutMs: 50 });
    expect(result.status).toBe("stuck");
    expect(result.reason).toBe("timeout");
    expect(surface.executed).toHaveLength(0);
  });

  it("injects prompt policy into the proposer context", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home" };
    let seenPolicy: string | undefined;
    const agent = new DiscoveryAgent(surface, {
      promptPolicy: "Do not transfer funds.",
      proposer: {
        async propose(context) {
          seenPolicy = context.promptPolicy;
          return { status: "success", candidates: [] };
        },
      },
    });
    await agent.run(request);
    expect(seenPolicy).toBe("Do not transfer funds.");
  });
});
