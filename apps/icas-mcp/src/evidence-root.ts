/**
 * @file Evidence root for replay logs. Redaction happens in the writer, not here.
 */

import { join } from "node:path";

/**
 * Resolve the evidence directory.
 *
 * @param env - Process env; tests pass a stub
 */
export function evidenceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ICAS_EVIDENCE_ROOT;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(process.cwd(), "evidence");
}
