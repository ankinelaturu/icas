/**
 * @file cli-prompt — approval and value questions over stdin, recorded as human evidence.
 *
 * CLI is the HITL form for "automation knows the next step but needs a yes or
 * a field." Browser takeover is the other form. Both tag `actor: "human"` so
 * replay logs never look like the agent typed the answer.
 *
 * @see takeOverBrowser
 */

import { createInterface } from "node:readline/promises";

import type { EvidenceWriter, RunType } from "@icas/evidence";

/**
 * Streams and evidence sink for one CLI question.
 *
 * Tests inject stdin so prompts do not block the real TTY.
 */
export interface CliPromptOptions {
  stdin: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  evidence: EvidenceWriter;
  runId: string;
  runType: RunType;
}

/**
 * Ask a yes/no question and record the answer as `actor: human`.
 *
 * Anything other than `y` / `yes` is treated as deny so an empty ENTER cannot
 * authorize a risky step.
 *
 * @param question - Text shown to the operator
 * @param options - Stdin/stdout plus the run-scoped evidence writer
 * @returns `true` when the operator types `y` or `yes` (case-insensitive)
 */
export async function promptForApproval(
  question: string,
  options: CliPromptOptions,
): Promise<boolean> {
  const answer = await readStdinLine(question, options);
  const approved = /^(y|yes)$/i.test(answer.trim());
  await options.evidence.append({
    timestamp: new Date().toISOString(),
    runId: options.runId,
    runType: options.runType,
    type: "human_input",
    actor: "human",
    payload: { kind: "approval", question, answer: answer.trim(), approved },
  });
  return approved;
}

/**
 * Ask for a required value and record the answer as `actor: human`.
 *
 * The raw answer is persisted through the evidence writer, which redacts
 * before disk. Callers still must not copy it into a capability artifact.
 *
 * @param question - Text shown to the operator
 * @param options - Stdin/stdout plus the run-scoped evidence writer
 * @returns Trimmed operator input
 */
export async function promptForValue(
  question: string,
  options: CliPromptOptions,
): Promise<string> {
  const answer = (await readStdinLine(question, options)).trim();
  await options.evidence.append({
    timestamp: new Date().toISOString(),
    runId: options.runId,
    runType: options.runType,
    type: "human_input",
    actor: "human",
    payload: { kind: "value", question, answer },
  });
  return answer;
}

/**
 * Read one line from stdin. Used by CLI prompts and browser-takeover ENTER waits.
 *
 * `terminal: false` keeps piped test streams from being treated as a TTY.
 * Always close the interface so a leftover readline does not hold the process.
 *
 * @param question - Prompt written to stdout
 * @param io - Readable stdin and optional stdout
 * @returns The line the operator typed, including surrounding whitespace
 */
export async function readStdinLine(
  question: string,
  io: Pick<CliPromptOptions, "stdin" | "stdout">,
): Promise<string> {
  const output = io.stdout ?? process.stdout;
  const rl = createInterface({
    input: io.stdin,
    output,
    terminal: false,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
