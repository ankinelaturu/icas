/**
 * @file Shared helpers for replay integration tests against HTML fixtures.
 *
 * Playwright opens `file:` URLs. Origin is `"null"`, so PolicyGuard must
 * allow that rather than `localhost` (used by the live tenant apps).
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyGuard } from "../../packages/policy/src/policy-guard.js";

const pagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pages",
);

/**
 * Absolute `file:` URL for a page under `tests/fixtures/pages`.
 *
 * @param name - Basename such as `home.html`
 */
export function pageUrl(name: string): string {
  return pathToFileURL(join(pagesDir, name)).href;
}

/**
 * Policy for fixture HTML. `file:` pages have origin `"null"`.
 */
export function fixturePolicy(): PolicyGuard {
  return new PolicyGuard({
    allowedOrigins: ["null"],
    allowedActionTypes: ["click", "fill", "select", "navigate", "read"],
  });
}
