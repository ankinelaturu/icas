/**
 * @file Shared helpers for replay integration tests against HTML fixtures.
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyGuard } from "../../packages/policy/src/policy-guard.js";

const pagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pages",
);

export function pageUrl(name: string): string {
  return pathToFileURL(join(pagesDir, name)).href;
}

export function fixturePolicy(): PolicyGuard {
  return new PolicyGuard({
    allowedOrigins: ["null"],
    allowedActionTypes: ["click", "fill", "select", "navigate", "read"],
  });
}
