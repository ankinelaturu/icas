import { describe, expect, it } from "vitest";

import { HandoffError } from "./handoff-error.js";
import { SessionHandoffController } from "./session-handoff-controller.js";
import type { InterventionRequest } from "./handoff-types.js";

const valid: InterventionRequest = {
  runId: "run-001",
  reason: "approval_required",
  message: "Generate the official payoff statement?",
};

describe("SessionHandoffController", () => {
  it("transfers ownership to human and back to automation", async () => {
    const handoff = new SessionHandoffController();
    expect(handoff.owner()).toBe("automation");
    await handoff.request(valid);
    expect(handoff.owner()).toBe("human");
    expect(handoff.currentIntervention()).toEqual(valid);
    const resumed = handoff.waitForResume();
    handoff.signalResume();
    await resumed;
    expect(handoff.owner()).toBe("automation");
    expect(handoff.currentIntervention()).toBeUndefined();
  });

  it("refuses automation actions while a human owns control", async () => {
    const handoff = new SessionHandoffController();
    await handoff.request(valid);
    try {
      handoff.assertAutomation();
      expect.fail("expected HUMAN_HAS_CONTROL");
    } catch (error) {
      expect(error).toBeInstanceOf(HandoffError);
      expect(error).toMatchObject({ code: "HUMAN_HAS_CONTROL" });
    }
  });

  it("rejects an intervention missing required fields", async () => {
    const handoff = new SessionHandoffController();
    await expect(
      handoff.request({ ...valid, runId: "  " }),
    ).rejects.toThrow(/runId is required/);
    await expect(
      handoff.request({ ...valid, message: "" }),
    ).rejects.toThrow(/message is required/);
    await expect(
      handoff.request({
        ...valid,
        reason: "not-a-reason" as InterventionRequest["reason"],
      }),
    ).rejects.toThrow(/reason/);
    expect(handoff.owner()).toBe("automation");
  });
});
