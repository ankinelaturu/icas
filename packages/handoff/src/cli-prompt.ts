/**
 * @file cli-prompt — approval and value questions over stdin, recorded as human evidence.
 */

import { createInterface } from "node:readline/promises";

import type { EvidenceWriter, RunType } from "@icas/evidence";

/**
 * Streams and evidence sink for one CLI question.
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
 * @returns `true` when the operator types `y` or `yes` (case-insensitive)
 */
export async function promptForApproval(
  question: string,
  options: CliPromptOptions,
): Promise<boolean> {
  const answer = await readLine(question, options);
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
 */
export async function promptForValue(
  question: string,
  options: CliPromptOptions,
): Promise<string> {
  const answer = (await readLine(question, options)).trim();
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

async function readLine(question: string, options: CliPromptOptions): Promise<string> {
  const output = options.stdout ?? process.stdout;
  const rl = createInterface({
    input: options.stdin,
    output,
    terminal: false,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
