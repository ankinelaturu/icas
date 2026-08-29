/**
 * Local driver: replay tests/fixtures/loan-payoff.capability.json against icas-bank.
 *
 *   pnpm icas-bank
 *   pnpm exec tsx replay-loan-payoff.ts
 *
 * Not a catalog artifact and not icas-play. ReplayEngine receives the JSON directly.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PlaywrightSurface } from "./packages/browser/src/playwright-surface.js";
import { validateCapabilityArtifact } from "./packages/capability/src/validate-capability.js";
import { PolicyGuard } from "./packages/policy/src/policy-guard.js";
import { ReplayEngine } from "./packages/replay/src/replay-engine.js";

const repo = dirname(fileURLToPath(import.meta.url));

/** Pause after open, after each surface action, and before close. */
const STEP_DELAY_MS = 1; //1_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const raw = JSON.parse(
    await readFile(join(repo, "tests/fixtures/loan-payoff.capability.json"), "utf8"),
  ) as unknown;
  const capability = validateCapabilityArtifact(raw);
  const outputNames = Object.keys(capability.outputs);
  let executeCount = 0;
  const surface = new PlaywrightSurface({ headed: true });
  const execute = surface.execute.bind(surface);
  surface.execute = async (action) => {
    const step = capability.steps[executeCount];
    if (step !== undefined) {
      const intent = "intent" in action && action.intent !== undefined
        ? ` — ${action.intent}`
        : "";
      console.log(
        `[step ${String(executeCount + 1)}/${String(capability.steps.length)}] ${step.id} (${action.type})${intent}`,
      );
    } else {
      const extractName = outputNames[executeCount - capability.steps.length];
      console.log(
        extractName === undefined
          ? `[action] ${action.type}`
          : `[extract] ${extractName}`,
      );
    }
    executeCount += 1;
    const result = await execute(action);
    await delay(STEP_DELAY_MS);
    return result;
  };
  const engine = new ReplayEngine(surface, {
    policy: new PolicyGuard({
      allowedOrigins: ["http://localhost:4101"],
      allowedActionTypes: ["click", "fill", "select", "navigate", "read"],
    }),
  });

  try {
    console.log("[open] http://localhost:4101/");
    await surface.open("http://localhost:4101/");
    await delay(STEP_DELAY_MS);
    const result = await engine.run(
      capability,
      { loanAccountId: "987654", payoffDate: "2026-12-30" },
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "success") {
      process.exitCode = 1;
    }
    await delay(STEP_DELAY_MS);
  } finally {
    await surface.close();
  }
}

void main();
