/**
 * @file Human-readable ReplayEngine result for stdout.
 *
 * Status and ids stay as labeled lines. Nested objects (especially
 * `business_outcome.details`) use indented JSON so operators can scan them.
 */

import type { ExecutionResult } from "@icas/replay";

/**
 * Pretty-print a structured field for the terminal.
 *
 * Compact stringify hides nested keys on one line. Indent 2 keeps heading,
 * summary, the hitting `message`, and match phrases readable.
 *
 * @param value - Replay field (object, string, or other JSON value)
 */
function formatJsonField(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Format one replay result as labeled lines plus indented JSON objects.
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
      lines.push(`details: ${formatJsonField(result.details)}`);
    }
    return lines.join("\n");
  }
  lines.push(`code: ${result.code}`);
  if (result.stepId !== undefined) {
    lines.push(`step: ${result.stepId}`);
  }
  if (result.expected !== undefined) {
    lines.push(`expected: ${formatJsonField(result.expected)}`);
  }
  if (result.observed !== undefined) {
    lines.push(`observed: ${formatJsonField(result.observed)}`);
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
