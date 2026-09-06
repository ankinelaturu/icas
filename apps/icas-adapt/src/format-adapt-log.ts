/**
 * @file Operator-facing adapt stage lines for stdout/stderr.
 *
 * Guarded replay and re-verify both return {@link ExecutionResult}. The CLI
 * used to print only a final summary (or a one-line rollback). These helpers
 * keep labeled fields so a failed enroll shows the miss, the patch, and the
 * re-verify stop.
 */

import type { CapabilityOverride, StepOverride } from "@icas/capability";
import type { ExecutionResult, GuardedReplayReport } from "@icas/replay";

/**
 * Pretty-print a structured replay field.
 *
 * @param value - Expected/observed or override JSON
 */
function formatJsonField(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Format one ReplayEngine result as labeled lines.
 *
 * @param result - Guarded replay or re-verify outcome
 */
export function formatAdaptExecution(result: ExecutionResult): string {
  const lines = [`status: ${result.status}`, `runId: ${result.runId}`];
  if (result.status === "success") {
    lines.push(`outputs: ${formatJsonField(result.outputs)}`);
  } else if (result.status === "business_outcome") {
    lines.push(`outcome: ${result.outcome}`);
    if (result.details !== undefined) {
      lines.push(`details: ${formatJsonField(result.details)}`);
    }
  } else {
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
  }
  lines.push(`raw result: ${formatJsonField(result)}`);
  return lines.join("\n");
}

/**
 * Format the guarded-replay classification plus evidence path.
 *
 * @param report - Compatible, mismatch, or business outcome
 * @param evidenceDir - Run directory when Playwright wrote evidence
 */
export function formatGuardedReplayReport(
  report: GuardedReplayReport,
  evidenceDir: string | undefined,
): string {
  const lines = [`guarded replay: ${report.status}`];
  if (report.status === "mismatch") {
    lines.push(`step: ${report.stepId}`);
  }
  lines.push(formatAdaptExecution(report.result));
  if (evidenceDir !== undefined && evidenceDir.length > 0) {
    lines.push(`evidence: ${evidenceDir}`);
  }
  return lines.join("\n");
}

/**
 * Dump captured page text in full. The specializer prompt is the clipped
 * copy actually sent to the model; this is what Playwright saw.
 *
 * @param pageText - Visible body text at the miss
 */
export function formatPageTextPreview(pageText: string): string {
  if (pageText.length === 0) {
    return "page text: (none)";
  }
  return `page text (${String(pageText.length)} chars):\n${pageText}`;
}

/**
 * Summarize the override that will be re-verified.
 *
 * @param override - Header-only or one-step patch
 */
export function formatOverrideSummary(override: CapabilityOverride): string {
  const lines = [
    `override id: ${override.id}`,
    `createdBy: ${override.provenance.createdBy}`,
    `reason: ${override.provenance.reason}`,
  ];
  const stepIds = Object.keys(override.overrides.steps ?? {});
  if (stepIds.length === 0) {
    lines.push("patch: header-only (overrides: {})");
    lines.push(`raw override: ${formatJsonField(override)}`);
    return lines.join("\n");
  }
  lines.push("patch:");
  for (const stepId of stepIds) {
    const patch = override.overrides.steps?.[stepId];
    if (patch === undefined) {
      continue;
    }
    lines.push(`  step ${stepId}:`);
    lines.push(indentBlock(formatStepOverride(patch), 4));
  }
  lines.push(`raw override: ${formatJsonField(override)}`);
  return lines.join("\n");
}

/**
 * Compact locator/checkpoint patch for one step.
 *
 * @param patch - Declarative StepOverride
 */
function formatStepOverride(patch: StepOverride): string {
  return formatJsonField(patch);
}

/**
 * Indent every line of a multiline block.
 *
 * @param text - Already formatted block
 * @param spaces - Leading spaces per line
 */
function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

/**
 * Final stdout after a kept enrollment.
 *
 * The first-run miss is already printed in the guarded-replay phase. This
 * block is the command outcome: enrolled, provenance, and re-verify success.
 * Do not reprint UNEXPECTED_STATE here; that looks like the command failed.
 *
 * @param args.tenant - Enrolled tenant
 * @param args.report - First guarded-replay classification
 * @param args.override - Persisted override
 * @param args.reverify - Second ReplayEngine result (no LLM)
 */
export function formatAdaptOutcome(args: {
  tenant: string;
  report: GuardedReplayReport;
  override?: CapabilityOverride;
  reverify?: ExecutionResult;
}): string {
  const createdBy = args.override?.provenance.createdBy;
  const lines = [`tenant: ${args.tenant}`, "status: enrolled"];
  if (createdBy !== undefined) {
    lines.push(`override provenance: ${createdBy}`);
  }
  if (args.report.status === "mismatch") {
    lines.push(`patched step: ${args.report.stepId}`);
    lines.push(
      `first-run miss: ${args.report.result.code} (${args.report.result.runId})`,
    );
  }
  if (args.reverify !== undefined) {
    lines.push(`re-verify: ${args.reverify.status}`);
    lines.push(`runId: ${args.reverify.runId}`);
    if (args.reverify.status === "success") {
      lines.push(`outputs: ${formatJsonField(args.reverify.outputs)}`);
    }
  } else if (args.report.status === "compatible") {
    lines.push(`runId: ${args.report.result.runId}`);
  }
  if (args.report.status === "compatible") {
    lines.push("enrolled header-only override (createdBy: verified)");
  } else {
    lines.push("re-verified effective capability; enrollment kept");
  }
  return lines.join("\n");
}

/**
 * Rollback error after re-verify failed. Message includes the second-run stop.
 */
export class AdaptReverifyError extends Error {
  readonly tenant: string;
  readonly reverify: ExecutionResult;
  readonly evidenceDir: string | undefined;

  /**
   * @param args.tenant - Tenant whose override was removed
   * @param args.reverify - Second ReplayEngine result
   * @param args.evidenceDir - Re-verify evidence directory when present
   */
  constructor(args: {
    tenant: string;
    reverify: ExecutionResult;
    evidenceDir?: string;
  }) {
    super(formatReverifyRollback(args));
    this.name = "AdaptReverifyError";
    this.tenant = args.tenant;
    this.reverify = args.reverify;
    this.evidenceDir = args.evidenceDir;
  }
}

/**
 * Multi-line rollback text so stderr is enough without scrolling stdout.
 *
 * @param args.tenant - Enrolled then rolled back
 * @param args.reverify - Failed second run
 * @param args.evidenceDir - Re-verify evidence directory
 */
export function formatReverifyRollback(args: {
  tenant: string;
  reverify: ExecutionResult;
  evidenceDir?: string;
}): string {
  const lines = [
    `override for tenant "${args.tenant}" failed re-verify; enrollment was rolled back`,
    "re-verify:",
    formatAdaptExecution(args.reverify),
  ];
  if (args.evidenceDir !== undefined && args.evidenceDir.length > 0) {
    lines.push(`evidence: ${args.evidenceDir}`);
  }
  return lines.join("\n");
}
