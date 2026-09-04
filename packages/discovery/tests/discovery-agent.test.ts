/**
 * @file DiscoveryAgent skeleton tests — fake proposer, no live model.
 */

import { describe, expect, it, vi } from "vitest";

import { PolicyGuard } from "@icas/policy";

import { DiscoveryAgent } from "../src/discovery-agent.js";
import { FakeProposer } from "./test-support/fake-proposer.js";
import { MINIMAL_SUCCESS_RESULT } from "./test-support/success-result.js";
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
      proposer: new FakeProposer([clickLending, { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT }]),
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
    expect(result.events.find((event) => event.type === "success")?.payload).toEqual({
      result: MINIMAL_SUCCESS_RESULT,
    });
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
          return { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT };
        },
      },
    });
    await agent.run(request);
    expect(seenPolicy).toBe("Do not transfer funds.");
  });

  it("tries rank 1 before rank 2 on the same node", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home" };
    surface.executeHandler = () => {
      surface.observation = { id: "lending" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [
            clickOn("Documents", 2),
            clickOn("Lending", 1),
          ],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run(request);
    expect(result.status).toBe("success");
    const clicked = surface.executed[0];
    expect(clicked?.type).toBe("click");
    if (clicked?.type === "click") {
      expect(clicked.target.strategies[0]).toMatchObject({ text: "Lending" });
    }
  });

  it("stops expansion when maxDepth is reached", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home" };
    surface.executeHandler = () => {
      surface.observation = { id: "lending" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        clickLending,
        clickLending,
      ]),
    });
    const result = await agent.run({ ...request, maxDepth: 1 });
    expect(result.status).toBe("stuck");
    expect(result.reason).toBe("maxDepth");
    expect(surface.executed).toHaveLength(1);
  });

  it("backtracks to the next sibling after a dead-end", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home" };
    surface.executeHandler = (action) => {
      const text =
        action.type === "click" ? action.target.strategies[0]?.text : undefined;
      surface.observation = { id: text === "Lending" ? "lending" : "documents" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [clickOn("Documents", 1), clickOn("Lending", 2)],
        },
        { status: "stuck", candidates: [], rationale: "grayed out" },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run(request);
    expect(result.status).toBe("success");
    expect(surface.executed.map((action) => action.type === "click" ? action.target.strategies[0]?.text : "")).toEqual([
      "Documents",
      "Lending",
    ]);
    expect(result.events.map((event) => event.type)).toContain("backtrack");
  });

  it("does not loop when an action repeats the current state", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost/home" };
    let clicks = 0;
    surface.executeHandler = () => {
      clicks += 1;
      if (clicks === 1) {
        return { status: "ok" };
      }
      surface.observation = { id: "lending", url: "http://localhost/lending" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [clickOn("Loans", 1), clickOn("Lending", 2)],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run({ ...request, maxSteps: 5 });
    expect(result.status).toBe("success");
    expect(clicks).toBe(2);
    expect(result.events.some((event) => event.type === "dead_end")).toBe(true);
  });

  it("restores a parent by replaying the prefix from the entry URL, not history-back", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost/home" };
    surface.executeHandler = (action) => {
      const text =
        action.type === "click" ? action.target.strategies[0]?.text : undefined;
      if (text === "Lending") {
        surface.observation = { id: "lending", url: "http://localhost/lending" };
      } else if (text === "Search") {
        surface.observation = { id: "search", url: "http://localhost/search" };
      } else {
        surface.observation = { id: "payoff", url: "http://localhost/payoff" };
      }
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        { status: "continue", candidates: [clickOn("Lending", 1)] },
        {
          status: "continue",
          candidates: [clickOn("Search", 1), clickOn("Payoff", 2)],
        },
        { status: "stuck", candidates: [], rationale: "empty results" },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run(request);
    expect(result.status).toBe("success");
    expect(surface.opens.length).toBeGreaterThanOrEqual(2);
    expect(surface.opens[0]).toBe(request.target.url);
    expect(surface.opens[1]).toBe(request.target.url);
    const labels = surface.executed.map((action) =>
      action.type === "click" ? action.target.strategies[0]?.text : "",
    );
    expect(labels).toEqual(["Lending", "Search", "Lending", "Payoff"]);
    expect(result.events.some((event) => {
      return event.type === "backtrack"
        && (event.payload as { restore?: string }).restore === "prefix-replay";
    })).toBe(true);
  });

  it("requests HITL on policy-block and resumes the same search node", async () => {
    const { SessionHandoffController } = await import("@icas/handoff");
    const handoff = new SessionHandoffController();
    const surface = new FakeSurface();
    surface.observation = { id: "home" };
    surface.executeHandler = () => {
      surface.observation = { id: "lending" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      handoff,
      policy: new PolicyGuard({
        allowedOrigins: ["http://localhost:4101"],
        allowedActionTypes: ["click", "fill", "select", "navigate", "read"],
      }),
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [clickOn("Make a payment", 1), clickOn("Lending", 2)],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const running = agent.run(request);
    await vi.waitFor(() => {
      expect(handoff.owner()).toBe("human");
    });
    handoff.signalResume();
    const result = await running;
    expect(result.status).toBe("success");
    expect(result.events.map((event) => event.type)).toContain("intervention");
    const labels = surface.executed.map((action) =>
      action.type === "click" ? action.target.strategies[0]?.text : "",
    );
    expect(labels).toEqual(["Lending"]);
  });

  it("prints observations, LLM proposals, and chosen actions when log is wired", async () => {
    const lines: string[] = [];
    const surface = new FakeSurface();
    surface.observation = {
      id: "home",
      url: "http://localhost:4101/",
      accessibilitySnapshot: "- heading: Lending",
    };
    surface.executeHandler = () => {
      surface.observation = { id: "lending", url: "http://localhost:4101/lending.htm" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([clickLending, { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT }]),
      log: (line) => {
        lines.push(line);
      },
    });
    await agent.run(request);
    const joined = lines.join("\n");
    expect(joined).toContain("observed id=home");
    expect(joined).toContain("- heading: Lending");
    expect(joined).toContain("LLM proposal:");
    expect(joined).toContain("chosen rank=1 click visibleText text=Lending");
    expect(joined).toContain("execute ok");
  });

  it("keeps the surface error message when execute throws TARGET_NOT_FOUND", async () => {
    const lines: string[] = [];
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost:4101/" };
    surface.executeHandler = () => {
      throw new Error("TARGET_NOT_FOUND: no control matched [label=LN Acct #]");
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([clickLending]),
      log: (line) => {
        lines.push(line);
      },
    });
    const result = await agent.run(request);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("TARGET_NOT_FOUND: no control matched [label=LN Acct #]");
    expect(result.events.some((event) => event.type === "action_result")).toBe(true);
    expect(lines.join("\n")).toContain("TARGET_NOT_FOUND");
    const candidates = result.events.find((event) => event.type === "candidates");
    expect(candidates?.payload).toMatchObject({
      status: "continue",
      count: 1,
      candidates: [{ rank: 1, rationale: "Open lending" }],
    });
  });

  it("executes a snapshot ref and records durable locators on chosen_action", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost:4103/" };
    surface.snapshotRefTarget = {
      strategies: [
        {
          type: "roleText",
          role: "link",
          text: "Share Holds Place a hold on available funds",
        },
      ],
    };
    surface.executeHandler = () => {
      surface.observation = { id: "holds", url: "http://localhost:4103/holds.htm" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [
            {
              action: {
                type: "click" as const,
                target: {
                  strategies: [
                    {
                      type: "visibleText" as const,
                      text: "Share Holds Place a hold on available funds",
                    },
                  ],
                },
                risk: "safe" as const,
              },
              snapshotRef: "e12",
              rationale: "Open share holds",
              rank: 1,
            },
          ],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run({
      ...request,
      id: "share-hold",
      target: { ...request.target, url: "http://localhost:4103/" },
    });
    expect(result.status).toBe("success");
    expect(surface.boundRefs).toEqual(["e12"]);
    expect(surface.executedRefs).toEqual(["e12"]);
    const chosen = result.events.find((event) => event.type === "chosen_action");
    expect(chosen?.payload).toMatchObject({
      action: {
        type: "click",
        target: {
          strategies: [
            {
              type: "roleText",
              role: "link",
              text: "Share Holds Place a hold on available funds",
            },
            {
              type: "visibleText",
              text: "Share Holds Place a hold on available funds",
            },
          ],
        },
      },
    });
    expect(JSON.stringify(chosen?.payload)).not.toMatch(/"e12"/);
    expect(surface.executed[0]).toEqual({
      type: "click",
      risk: "safe",
      target: {
        strategies: [
          {
            type: "roleText",
            role: "link",
            text: "Share Holds Place a hold on available funds",
          },
          {
            type: "visibleText",
            text: "Share Holds Place a hold on available funds",
          },
        ],
      },
    });
  });

  it("still executes a snapshot ref when bind cannot describe the node", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "find", url: "http://localhost:4103/holds.htm" };
    surface.bindError = new Error(
      "TARGET_NOT_FOUND: snapshot ref bound to a node with no durable locator",
    );
    surface.executeHandler = () => {
      surface.observation = { id: "shares", url: "http://localhost:4103/shares.htm" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [
            {
              action: {
                type: "fill" as const,
                target: {
                  strategies: [{ type: "relative" as const, text: "Member #" }],
                },
                value: { literal: "441122" },
                risk: "safe" as const,
              },
              snapshotRef: "f1e18",
              rationale: "Enter the member number",
              rank: 1,
              proposedInputParam: { name: "memberId", type: "string", required: true },
            },
          ],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run({
      ...request,
      id: "share-hold",
      target: { ...request.target, url: "http://localhost:4103/holds.htm" },
    });
    expect(result.status).toBe("success");
    expect(surface.boundRefs).toEqual(["f1e18"]);
    expect(surface.executedRefs).toEqual(["f1e18"]);
    const chosen = result.events.find((event) => event.type === "chosen_action");
    expect(chosen?.payload).toMatchObject({
      action: {
        type: "fill",
        target: {
          strategies: [{ type: "relative", text: "Member #" }],
        },
      },
    });
  });

  it("falls back to ranked locators when snapshot-ref execute fails", async () => {
    const surface = new FakeSurface();
    surface.observation = { id: "home", url: "http://localhost:4101/" };
    surface.executeSnapshotRefError = new Error(
      "TARGET_NOT_FOUND: snapshot ref e12 is not visible",
    );
    surface.executeHandler = () => {
      surface.observation = { id: "lending", url: "http://localhost:4101/lending.htm" };
      return { status: "ok" };
    };
    const agent = new DiscoveryAgent(surface, {
      proposer: new FakeProposer([
        {
          status: "continue",
          candidates: [
            {
              action: {
                type: "click" as const,
                target: {
                  strategies: [{ type: "visibleText" as const, text: "Lending" }],
                },
                risk: "safe" as const,
              },
              snapshotRef: "e12",
              rationale: "Open lending",
              rank: 1,
            },
          ],
        },
        { status: "success", candidates: [], result: MINIMAL_SUCCESS_RESULT },
      ]),
    });
    const result = await agent.run(request);
    expect(result.status).toBe("success");
    expect(surface.executedRefs).toEqual(["e12"]);
    expect(surface.executed).toHaveLength(1);
    expect(surface.executed[0]).toMatchObject({
      type: "click",
      target: {
        strategies: [
          { type: "roleText", role: "link", text: "Lending" },
          { type: "visibleText", text: "Lending" },
        ],
      },
    });
  });
});

function clickOn(text: string, rank: number) {
  return {
    action: {
      type: "click" as const,
      target: { strategies: [{ type: "visibleText" as const, text }] },
      risk: "safe" as const,
    },
    rationale: text,
    rank,
  };
}
