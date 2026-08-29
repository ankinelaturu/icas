/**
 * @file Catalog root for FileSystemCapabilityRegistry.
 *
 * Tests inject `ICAS_CAPABILITIES_ROOT` so they never write the submission dir.
 */

import { join } from "node:path";

/**
 * Resolve the catalog directory.
 *
 * @param env - Process env; tests pass a stub
 */
export function catalogRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ICAS_CAPABILITIES_ROOT;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(process.cwd(), "capabilities");
}
