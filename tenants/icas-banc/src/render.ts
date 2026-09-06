/**
 * @file Load hand-authored HTML and substitute {{tokens}} without wrapping a layout.
 *
 * Each page is a complete legacy-style document. A shared layout would hide
 * the per-page markup that discovery actually sees.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/**
 * Read a page file and replace `{{name}}` tokens.
 *
 * Unknown tokens stay in the document so a missing var is visible in the
 * demo rather than silently emptying. Values are HTML-escaped.
 *
 * @param pagesDir - Directory of hand-authored HTML files
 * @param fileName - Page basename (not a path)
 * @param vars - Token name → substitution
 */
export function renderPage(
  pagesDir: string,
  fileName: string,
  vars: Record<string, string> = {},
): string {
  const html = readFileSync(join(pagesDir, fileName), "utf8");
  return html.replace(TOKEN, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      return whole;
    }
    return escapeHtml(value);
  });
}

/** Escape so synthetic loan fields cannot break out of HTML text/attributes. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
