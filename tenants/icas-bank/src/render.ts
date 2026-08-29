/**
 * @file Load hand-authored HTML and substitute {{tokens}} without wrapping a layout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/**
 * Read a page file and replace `{{name}}` tokens.
 *
 * Unknown tokens stay in the document. Values are HTML-escaped.
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
