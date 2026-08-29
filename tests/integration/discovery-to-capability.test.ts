/**
 * @file Discovery → compiler integration against HTML fixtures (no live LLM).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "../../packages/browser/src/playwright-surface.js";
import {
  FileSystemCapabilityRegistry,
  validateCapabilityArtifact,
} from "../../packages/capability/src/index.js";
import { CapabilityCompiler } from "../../packages/discovery/src/capability-compiler.js";
import { DiscoveryAgent } from "../../packages/discovery/src/discovery-agent.js";
import { FakeProposer } from "../../packages/discovery/src/test-support/fake-proposer.js";

import { fixturePolicy, pageUrl } from "./fixture-pages.js";

describe("discovery-to-capability integration", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 8_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("discovers the fixture lending path and compiles a validated capability", async () => {
    const root = await mkdtemp(join(tmpdir(), "icas-discovery-int-"));
    const registry = new FileSystemCapabilityRegistry({ root });
    try {
      const agent = new DiscoveryAgent(surface, {
        policy: fixturePolicy(),
        proposer: new FakeProposer([
          continueClick("button", "Lending", "Lending Services"),
          continueClick("link", "Loan Search", "Search Loan Account"),
          {
            status: "continue",
            candidates: [
              {
                action: {
                  type: "fill",
                  target: { strategies: [{ type: "label", label: "Loan Account" }] },
                  value: { literal: "987654" },
                  risk: "safe",
                },
                rationale: "Enter the loan account",
                rank: 1,
                expectation: "Loan Account",
              },
            ],
          },
          continueClick("button", "Search", "Payoff Statement"),
          { status: "success", candidates: [] },
        ]),
      });
      const result = await agent.run({
        id: "loan-payoff",
        goal: "Generate a payoff statement",
        target: {
          vendor: "icas-bank",
          product: "icas-bank",
          tenant: "icas-bank",
          url: pageUrl("home.html"),
        },
      });
      expect(result.status).toBe("success");

      const artifact = await new CapabilityCompiler().compile({
        id: "loan-payoff",
        name: "Generate Loan Payoff Statement",
        target: { vendor: "icas-bank", product: "icas-bank", tenant: "icas-bank" },
        events: result.events,
        inputValues: {
          loanAccountId: { type: "string", value: "987654", description: "Loan account identifier" },
        },
        registry,
        runId: result.runId,
      });
      expect(() => validateCapabilityArtifact(artifact)).not.toThrow();
      expect(artifact.steps.some((step) => step.action.type === "fill")).toBe(true);
      const fill = artifact.steps.find((step) => step.action.type === "fill");
      expect(fill?.action).toMatchObject({ value: { input: "loanAccountId" } });
      expect(JSON.stringify(artifact.steps)).not.toContain("987654");
      expect(artifact.success).toEqual([{ type: "textVisible", value: "Payoff Statement" }]);
      const stored = await registry.get("loan-payoff");
      expect(stored?.id).toBe("loan-payoff");
      const override = await registry.getOverride("icas-bank", "loan-payoff@1.0.0");
      expect(override?.overrides).toEqual({});
      expect(override?.provenance.createdBy).toBe("discovery");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function continueClick(role: string, text: string, expectation: string) {
  return {
    status: "continue" as const,
    candidates: [
      {
        action: {
          type: "click" as const,
          target: { strategies: [{ type: "roleText" as const, role, text }] },
          risk: "safe" as const,
        },
        rationale: text,
        rank: 1,
        expectation,
      },
    ],
  };
}
