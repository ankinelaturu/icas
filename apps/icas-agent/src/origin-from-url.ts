/**
 * @file Map `--url` to a PolicyGuard origin allowlist entry.
 *
 * `--url` only opens the surface. Identity is never read from the host.
 */

/**
 * Return `new URL(url).origin` for the runtime policy allowlist.
 *
 * @param url - Operator-supplied `--url`
 * @returns Origin string, including `"null"` for `file:`
 * @throws {Error} When `url` is not a valid absolute URL
 */
export function originFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid --url "${url}"`);
  }
  return parsed.origin;
}
