/**
 * @file Human-action classification: recurring approval vs exceptional recovery.
 */

import { describe, expect, it } from "vitest";

import { CapabilityCompiler } from "./capability-compiler.js";
import { classifyHumanIntervention } from "./classify-intervention.js";
import { extractSuccessfulPath } from "./extract-successful-path.js";

describe("classifyHumanIntervention", () => {
  it("maps recurring approval to a handoff step", () => {
    expect(classifyHumanIntervention("approval_required")).toBe("handoff");
  });

  it("keeps exceptional recovery as evidence", () => {
    expect(classifyHumanIntervention("policy_block")).toBe("evidence");
    expect(classifyHumanIntervention("discovery_stuck")).toBe("evidence");
  });
});

describe("CapabilityCompiler human actions", () => {
  it("inserts a handoff step for recurring approval on the success path", async () => {
    const compiler = new CapabilityCompiler();
    const artifact = await compiler.compile({
      id: "loan-payoff",
      target: { vendor: "icas-bank", product: "icas-bank" },
      events: [
        {
          type: "chosen_action",
          payload: {
            rank: 1,
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Approve" }] },
              risk: "risky",
            },
            expectation: "Approved",
          },
        },
        {
          type: "intervention",
          payload: { reason: "approval_required", message: "manager approval required" },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success" },
      ],
    });
    expect(artifact.steps.map((step) => step.action.type)).toEqual(["handoff", "click"]);
    expect(artifact.steps[0]?.action).toEqual({
      type: "handoff",
      reason: "manager approval required",
    });
  });

  it("does not compile exceptional policy-block recovery into the happy path", async () => {
    const path = extractSuccessfulPath([
      {
        type: "chosen_action",
        payload: {
          rank: 1,
          action: {
            type: "click",
            target: { strategies: [{ type: "visibleText", text: "External Portal" }] },
          },
        },
      },
      {
        type: "intervention",
        payload: { reason: "policy_block", message: "origin not allowed" },
      },
      {
        type: "chosen_action",
        payload: {
          rank: 2,
          action: {
            type: "click",
            target: { strategies: [{ type: "visibleText", text: "Lending" }] },
          },
          expectation: "Lending Services",
        },
      },
      { type: "action_result", payload: { status: "ok" } },
      { type: "success" },
    ]);
    expect(path).toHaveLength(1);
    expect(path[0]?.action).toMatchObject({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Lending" }] },
    });
    expect(path[0]?.insertHandoff).toBeUndefined();
    const compiler = new CapabilityCompiler();
    const artifact = await compiler.compile({
      id: "loan-payoff",
      target: { vendor: "icas-bank", product: "icas-bank" },
      events: [
        {
          type: "chosen_action",
          payload: {
            rank: 1,
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "External Portal" }] },
            },
          },
        },
        {
          type: "intervention",
          payload: { reason: "policy_block", message: "origin not allowed" },
        },
        {
          type: "chosen_action",
          payload: {
            rank: 2,
            action: {
              type: "click",
              target: { strategies: [{ type: "visibleText", text: "Lending" }] },
            },
            expectation: "Lending Services",
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success" },
      ],
    });
    expect(artifact.steps).toHaveLength(1);
    expect(JSON.stringify(artifact.steps)).not.toContain("handoff");
    expect(JSON.stringify(artifact.steps)).not.toContain("External Portal");
  });
});
