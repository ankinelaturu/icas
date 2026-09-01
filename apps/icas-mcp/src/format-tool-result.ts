/**
 * @file Format ReplayEngine results for an MCP tool response.
 *
 * Do not re-match page phrases here. Replay already put `heading`, `summary`,
 * and the hitting `phrase` on `business_outcome.details`. Evidence still holds
 * the screenshot; this adapter only formats the calling agent's text.
 */

import type { ExecutionResult } from "@icas/replay";

/**
 * MCP tool payload. `isError` is a protocol failure, not a domain stop.
 */
export interface McpToolResult {
  [key: string]: unknown;
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Copy replay already classified from `possibleOutcomes`.
 */
export interface BusinessOutcomeCopy {
  heading: string | null;
  summary: string | null;
  phrase: string | undefined;
}

/**
 * Turn a structured replay result into MCP content.
 *
 * @param result - ReplayEngine terminal result
 */
export function formatMcpToolResult(result: ExecutionResult): McpToolResult {
  if (result.status === "success") {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (result.status === "business_outcome") {
    return {
      content: [{ type: "text", text: formatBusinessOutcomeMessage(result) }],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

/**
 * Human-readable domain stop plus the structured result for hosts that parse JSON.
 *
 * @param result - Classified `business_outcome`
 */
export function formatBusinessOutcomeMessage(
  result: Extract<ExecutionResult, { status: "business_outcome" }>,
): string {
  const copy = readBusinessOutcomeCopy(result.details);
  const title = copy.heading ?? result.outcome;
  const lines = [title];
  if (copy.summary !== null && copy.summary !== undefined && copy.summary.length > 0) {
    lines.push(copy.summary);
  }
  if (copy.phrase !== undefined && copy.phrase.length > 0) {
    lines.push(`Matched: ${copy.phrase}`);
  }
  lines.push(JSON.stringify(result));
  return lines.join("\n");
}

/**
 * Read heading/summary/phrase from replay `details` without matching the page.
 *
 * @param details - Opaque `ExecutionResult.details`
 */
export function readBusinessOutcomeCopy(details: unknown): BusinessOutcomeCopy {
  if (details === null || typeof details !== "object") {
    return { heading: null, summary: null, phrase: undefined };
  }
  const record = details as Record<string, unknown>;
  return {
    heading: nullableString(record.heading),
    summary: nullableString(record.summary),
    phrase: typeof record.phrase === "string" ? record.phrase : undefined,
  };
}

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : null;
}
