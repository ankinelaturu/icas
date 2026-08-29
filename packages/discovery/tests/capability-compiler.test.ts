/**
 * @file Compiler keeps only the success-path stack; failed branches stay evidence.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystemCapabilityRegistry, validateCapabilityArtifact } from "@icas/capability";
import { describe, expect, it } from "vitest";

import { CapabilityCompiler } from "../src/capability-compiler.js";
import { extractSuccessfulPath } from "../src/extract-successful-path.js";

const fixtureTrace = join(
  dirname(fileURLToPath(import.meta.url)),
  "test-support/traces/dead-end-then-success.jsonl",
);

describe("extractSuccessfulPath", () => {
  it("drops a dead-end click after backtrack", async () => {
    const { loadTraceEvents } = await import("../src/capability-compiler.js");
    const events = await loadTraceEvents({ tracePath: fixtureTrace });
    const path = extractSuccessfulPath(events);
    expect(path).toHaveLength(1);
    expect(path[0]?.action).toMatchObject({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Lending" }] },
    });
  });
});

describe("CapabilityCompiler", () => {
  it("compiles only success steps from a fixture trace with a dead-end", async () => {
    const compiler = new CapabilityCompiler();
    const artifact = await compiler.compile({
      id: "loan-payoff",
      name: "Generate Loan Payoff Statement",
      target: { vendor: "icas-bank", product: "icas-bank" },
      tracePath: fixtureTrace,
    });
    expect(artifact.steps).toHaveLength(1);
    expect(artifact.steps[0]?.id).toBe("click-lending");
    expect(artifact.steps[0]?.action).toMatchObject({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Lending" }] },
    });
    expect(JSON.stringify(artifact.steps)).not.toContain("Documents");
    expect(artifact.success).toEqual([
      { type: "textVisible", value: "Lending Services" },
    ]);
  });

  it("replaces loan id 987654 with an input reference", async () => {
    const compiler = new CapabilityCompiler();
    const artifact = await compiler.compile({
      id: "loan-payoff",
      target: { vendor: "icas-bank", product: "icas-bank" },
      inputValues: {
        loanAccountId: { type: "string", value: "987654", description: "Loan account identifier" },
      },
      events: [
        {
          type: "chosen_action",
          payload: {
            id: "cand-1-0",
            rank: 1,
            action: {
              type: "fill",
              target: { strategies: [{ type: "label", label: "Loan Account" }] },
              value: { literal: "987654" },
              risk: "safe",
            },
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success" },
      ],
    });
    expect(artifact.steps[0]?.action).toMatchObject({
      type: "fill",
      value: { input: "loanAccountId" },
    });
    expect(artifact.inputs.loanAccountId).toEqual({
      type: "string",
      required: true,
      description: "Loan account identifier",
    });
  });

  it("derives checkpoints, strips coordinates, and persists via the registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "icas-discovery-catalog-"));
    const registry = new FileSystemCapabilityRegistry({ root });
    try {
      const compiler = new CapabilityCompiler();
      const artifact = await compiler.compile({
        id: "loan-payoff",
        name: "Generate Loan Payoff Statement",
        target: { vendor: "icas-bank", product: "icas-bank", tenant: "icas-bank" },
        registry,
        runId: "run-discover-1",
        inputValues: {
          loanAccountId: { type: "string", value: "987654" },
        },
        events: [
          { type: "observation", payload: { id: "home", url: "http://localhost/home.html" } },
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "click",
                target: {
                  strategies: [
                    { type: "visibleText", text: "Lending" },
                    { type: "coordinates", x: 12, y: 12 },
                  ],
                },
                risk: "safe",
              },
              expectation: "Lending Services",
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "observation", payload: { id: "lending", url: "http://localhost/lending.html" } },
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "Loan Account" }] },
                value: { literal: "987654" },
                risk: "safe",
              },
              expectation: "Search Loan Account",
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "observation", payload: { id: "search", url: "http://localhost/loan-search.html" } },
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "read",
                target: { strategies: [{ type: "label", label: "Total Payoff Amount" }] },
                intent: "totalPayoffAmount",
              },
              expectation: "Payoff Statement",
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "observation", payload: { id: "statement", url: "http://localhost/statement.html" } },
          { type: "success" },
        ],
      });
      expect(() => validateCapabilityArtifact(artifact)).not.toThrow();
      expect(artifact.schemaVersion).toBe("1.0");
      expect(artifact.capabilityVersion).toBe("1.0.0");
      expect(artifact.target).toEqual({ vendor: "icas-bank", product: "icas-bank" });
      expect(artifact.discoveredOn).toEqual({ tenant: "icas-bank" });
      expect(JSON.stringify(artifact.steps[0]?.action)).not.toContain("coordinates");
      expect(artifact.steps[0]?.postconditions).toEqual(
        expect.arrayContaining([{ type: "textVisible", value: "Lending Services" }]),
      );
      expect(artifact.outputs.totalPayoffAmount).toMatchObject({
        type: "money",
        extract: { target: { strategies: [{ type: "label", label: "Total Payoff Amount" }] } },
      });
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
