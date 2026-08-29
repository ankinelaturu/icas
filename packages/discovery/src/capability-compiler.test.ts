/**
 * @file Compiler keeps only the success-path stack; failed branches stay evidence.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CapabilityCompiler } from "./capability-compiler.js";
import { extractSuccessfulPath } from "./extract-successful-path.js";

const fixtureTrace = join(
  dirname(fileURLToPath(import.meta.url)),
  "test-support/traces/dead-end-then-success.jsonl",
);

describe("extractSuccessfulPath", () => {
  it("drops a dead-end click after backtrack", async () => {
    const { loadTraceEvents } = await import("./capability-compiler.js");
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
    expect(artifact.steps[0]?.id).toBe("click-1");
    expect(artifact.steps[0]?.action).toMatchObject({
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "Lending" }] },
    });
    expect(JSON.stringify(artifact.steps)).not.toContain("Documents");
    expect(artifact.success).toEqual([
      { type: "textVisible", value: "Lending Services" },
    ]);
  });
});
