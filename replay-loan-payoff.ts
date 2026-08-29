/**
 * @file Throwaway local driver: replay a fixture JSON against icas-bank.
 *
 *   pnpm icas-bank
 *   pnpm exec tsx replay-loan-payoff.ts
 *
 * Not a catalog artifact and not `icas-play`. It feeds `ReplayEngine` a
 * validated fixture so replay can be watched without enrollment, argv, or
 * registry lookup. Do not treat this as the production CLI path.
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

/**
 * Yield so a headed browser is watchable. `1` keeps this driver snappy;
 * restore `1500` when demonstrating the UI by eye.
 */
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
  // Wrap execute for console tracing only — do not grow ReplayEngine's public API for a driver.
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
      // After declared steps, remaining actions are output extracts.
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
      // icas-bank only. Fail closed if this driver is pointed at Loki (4102).
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
      // Set exitCode instead of process.exit so `finally` still closes the browser.
      process.exitCode = 1;
    }
    await delay(STEP_DELAY_MS);
  } finally {
    await surface.close();
  }
}

void main();
