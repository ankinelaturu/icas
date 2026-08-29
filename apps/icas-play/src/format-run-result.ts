/**
 * @file Human-readable ReplayEngine result for stdout.
 */

import type { ExecutionResult } from "@icas/replay";

/**
 * Format one replay result. JSON is avoided so operators can scan the terminal.
 *
 * @param result - Structured outcome from {@link ReplayEngine.run}
 */
export function formatRunResult(result: ExecutionResult): string {
  const lines = [
    `status: ${result.status}`,
    `capability: ${result.capabilityId}`,
    `runId: ${result.runId}`,
  ];
  if (result.status === "success") {
    const names = Object.keys(result.outputs);
    if (names.length === 0) {
      lines.push("outputs: (none)");
    } else {
      lines.push("outputs:");
      for (const name of names) {
        lines.push(`  ${name}: ${JSON.stringify(result.outputs[name])}`);
      }
    }
    return lines.join("\n");
  }
  if (result.status === "business_outcome") {
    lines.push(`outcome: ${result.outcome}`);
    if (result.details !== undefined) {
      lines.push(`details: ${JSON.stringify(result.details)}`);
    }
    return lines.join("\n");
  }
  lines.push(`code: ${result.code}`);
  if (result.stepId !== undefined) {
    lines.push(`step: ${result.stepId}`);
  }
  if (result.expected !== undefined) {
    lines.push(`expected: ${JSON.stringify(result.expected)}`);
  }
  if (result.observed !== undefined) {
    lines.push(`observed: ${JSON.stringify(result.observed)}`);
  }
  return lines.join("\n");
}

/**
 * Exit 0 only for `success`. Domain stops and classified failures are nonzero.
 *
 * @param result - Structured outcome
 */
export function exitCodeForResult(result: ExecutionResult): number {
  return result.status === "success" ? 0 : 1;
}
