/**
 * @file Compiler keeps only the success-path stack; failed branches stay evidence.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystemCapabilityRegistry, validateCapabilityArtifact } from "@icas/capability";
import { describe, expect, it } from "vitest";

import { CapabilityCompiler } from "../src/capability-compiler.js";
import { extractSuccessfulPath } from "../src/extract-successful-path.js";
import { ParameterizeError } from "../src/parameterize-inputs.js";

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

  it("keeps proposedInputParam from chosen_action", () => {
    const path = extractSuccessfulPath([
      {
        type: "chosen_action",
        payload: {
          rank: 1,
          action: {
            type: "fill",
            target: { strategies: [{ type: "label", label: "Account" }] },
            value: { literal: "42" },
            risk: "safe",
          },
          proposedInputParam: { name: "accountId", type: "string", required: true },
        },
      },
      { type: "action_result", payload: { status: "ok" } },
      { type: "success" },
    ]);
    expect(path).toHaveLength(1);
    expect(path[0]?.proposedInputParam).toEqual({
      name: "accountId",
      type: "string",
      required: true,
    });
    expect(path[0]?.action).toMatchObject({ value: { literal: "42" } });
  });

  it("keeps possibleOutcomes from chosen_action", () => {
    const path = extractSuccessfulPath([
      {
        type: "chosen_action",
        payload: {
          rank: 1,
          action: {
            type: "click",
            target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
            risk: "safe",
          },
          possibleOutcomes: [
            {
              kind: "error",
              match: { phrases: ["Loan not found"] },
              heading: "Loan not found",
              summary: "No loan matches the requested account id.",
            },
          ],
        },
      },
      { type: "action_result", payload: { status: "ok" } },
      { type: "success" },
    ]);
    expect(path[0]?.possibleOutcomes).toEqual([
      {
        kind: "error",
        match: { phrases: ["Loan not found"] },
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
      },
    ]);
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
    expect(artifact.steps[0]?.possibleOutcomes).toEqual([]);
  });

  it("rewrites fill literals from proposedInputParam without a CLI value map", async () => {
    const compiler = new CapabilityCompiler();
    const artifact = await compiler.compile({
      id: "loan-payoff",
      target: { vendor: "icas-bank", product: "icas-bank" },
      events: [
        {
          type: "chosen_action",
          payload: {
            id: "cand-1-0",
            rank: 1,
            action: {
              type: "fill",
              target: { strategies: [{ type: "label", label: "Account" }] },
              value: { literal: "42" },
              risk: "safe",
            },
            proposedInputParam: { name: "accountId", type: "string", required: true },
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success" },
      ],
    });
    expect(artifact.steps[0]?.action).toMatchObject({
      type: "fill",
      value: { input: "accountId" },
    });
    expect(artifact.inputs.accountId).toEqual({
      type: "string",
      required: true,
    });
    expect(JSON.stringify(artifact.steps)).not.toContain("42");
  });

  it("fails when fill has no proposedInputParam", async () => {
    const compiler = new CapabilityCompiler();
    await expect(
      compiler.compile({
        id: "loan-payoff",
        target: { vendor: "icas-bank", product: "icas-bank" },
        events: [
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "Account" }] },
                value: { literal: "42" },
                risk: "safe",
              },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "success" },
        ],
      }),
    ).rejects.toBeInstanceOf(ParameterizeError);
  });

  it("fails when the same literal is bound to two names", async () => {
    const compiler = new CapabilityCompiler();
    await expect(
      compiler.compile({
        id: "loan-payoff",
        target: { vendor: "icas-bank", product: "icas-bank" },
        events: [
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "Account" }] },
                value: { literal: "42" },
                risk: "safe",
              },
              proposedInputParam: { name: "accountId", type: "string", required: true },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "Confirm" }] },
                value: { literal: "42" },
                risk: "safe",
              },
              proposedInputParam: { name: "confirmId", type: "string", required: true },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "success" },
        ],
      }),
    ).rejects.toThrow(/bound to both/);
  });

  it("fails when the same name has a type clash", async () => {
    const compiler = new CapabilityCompiler();
    await expect(
      compiler.compile({
        id: "loan-payoff",
        target: { vendor: "icas-bank", product: "icas-bank" },
        events: [
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "When" }] },
                value: { literal: "2026-09-30" },
                risk: "safe",
              },
              proposedInputParam: { name: "asOfDate", type: "date", required: true },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "fill",
                target: { strategies: [{ type: "label", label: "As of" }] },
                value: { literal: "2026-09-30" },
                risk: "safe",
              },
              proposedInputParam: { name: "asOfDate", type: "string", required: true },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          { type: "success" },
        ],
      }),
    ).rejects.toThrow(/type\/required clash/);
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
                value: { literal: "42" },
                risk: "safe",
              },
              proposedInputParam: { name: "accountId", type: "string", required: true },
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
          // No `result` payload: outputs come from the `read` step; success from last expectation.
          { type: "success" },
        ],
      });
      expect(() => validateCapabilityArtifact(artifact)).not.toThrow();
      expect(artifact.schemaVersion).toBe("1.0");
      expect(artifact.id).toBe("loan-payoff");
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
      const override = await registry.getOverride("icas-bank", "loan-payoff");
      expect(override?.overrides).toEqual({});
      expect(override?.provenance.createdBy).toBe("discovery");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("copies error and hitl possibleOutcomes and strips success", async () => {
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
              target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
              risk: "safe",
            },
            possibleOutcomes: [
              {
                kind: "success",
                match: { phrases: ["Loan Details"] },
                heading: null,
                summary: null,
              },
              {
                kind: "error",
                match: { phrases: ["Loan not found"] },
                heading: "Loan not found",
                summary: "No loan matches the requested account id.",
              },
              {
                kind: "hitl",
                match: { phrases: ["Call member services"] },
                heading: "Need assistance",
                summary: "A person must continue this session.",
              },
            ],
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success" },
      ],
    });
    expect(artifact.steps[0]?.possibleOutcomes).toEqual([
      {
        kind: "error",
        match: { phrases: ["Loan not found"] },
        heading: "Loan not found",
        summary: "No loan matches the requested account id.",
      },
      {
        kind: "hitl",
        match: { phrases: ["Call member services"] },
        heading: "Need assistance",
        summary: "A person must continue this session.",
      },
    ]);
  });

  it("prefers success-event result over read steps and last-step expectation", async () => {
    const compiler = new CapabilityCompiler();
    const declared = {
      successSignals: [
        { type: "textVisible" as const, value: "Statement is ready" },
        { type: "urlMatches" as const, pattern: "/lending/payoff.htm" },
      ],
      outputs: [
        {
          name: "statementTotal",
          type: "money" as const,
          description: "Quoted total",
          extract: {
            target: { strategies: [{ type: "relative" as const, text: "Statement total" }] },
          },
        },
      ],
    };
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
              target: { strategies: [{ type: "visibleText", text: "Inquire" }] },
              risk: "safe",
            },
            expectation: "Would be ignored",
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        {
          type: "chosen_action",
          payload: {
            rank: 1,
            action: {
              type: "read",
              target: { strategies: [{ type: "label", label: "Total Payoff Amount" }] },
              intent: "totalPayoffAmount",
            },
          },
        },
        { type: "action_result", payload: { status: "ok" } },
        { type: "success", payload: { result: declared } },
      ],
    });
    expect(artifact.success).toEqual(declared.successSignals);
    expect(artifact.outputs.statementTotal).toEqual({
      type: "money",
      description: "Quoted total",
      extract: { target: { strategies: [{ type: "relative", text: "Statement total" }] } },
    });
    // Declared contract wins; do not also harvest the read step.
    expect(artifact.outputs.totalPayoffAmount).toBeUndefined();
  });

  it("round-trips success result through JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icas-result-trace-"));
    const tracePath = join(dir, "trace.jsonl");
    const declared = {
      successSignals: [{ type: "textVisible", value: "Statement is ready" }],
      outputs: [
        {
          name: "statementTotal",
          type: "money",
          extract: {
            target: { strategies: [{ type: "relative", text: "Statement total" }] },
          },
        },
      ],
    };
    const events = [
      {
        type: "chosen_action",
        payload: {
          rank: 1,
          action: {
            type: "click",
            target: { strategies: [{ type: "visibleText", text: "Lending" }] },
            risk: "safe",
          },
        },
      },
      { type: "action_result", payload: { status: "ok" } },
      { type: "success", payload: { result: declared } },
    ];
    try {
      await writeFile(
        tracePath,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      );
      const artifact = await new CapabilityCompiler().compile({
        id: "loan-payoff",
        target: { vendor: "icas-bank", product: "icas-bank" },
        tracePath,
      });
      expect(artifact.success).toEqual(declared.successSignals);
      expect(artifact.outputs.statementTotal?.type).toBe("money");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails compile when result declares duplicate output names", async () => {
    const compiler = new CapabilityCompiler();
    const output = {
      name: "statementTotal",
      type: "money" as const,
      extract: {
        target: { strategies: [{ type: "relative" as const, text: "Statement total" }] },
      },
    };
    await expect(
      compiler.compile({
        id: "loan-payoff",
        target: { vendor: "icas-bank", product: "icas-bank" },
        events: [
          {
            type: "chosen_action",
            payload: {
              rank: 1,
              action: {
                type: "click",
                target: { strategies: [{ type: "visibleText", text: "Lending" }] },
                risk: "safe",
              },
            },
          },
          { type: "action_result", payload: { status: "ok" } },
          {
            type: "success",
            payload: {
              result: {
                successSignals: [{ type: "textVisible", value: "done" }],
                outputs: [output, output],
              },
            },
          },
        ],
      }),
    ).rejects.toThrow(/duplicate output name/);
  });
});
