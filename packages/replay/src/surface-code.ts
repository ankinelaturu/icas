/**
 * @file surface-code — detect structured SurfaceError codes without importing @icas/browser.
 *
 * Replay must stay tenant-agnostic and surface-agnostic. Duck-typing `code`
 * avoids a package cycle while still mapping `TARGET_NOT_FOUND` into the
 * replay taxonomy.
 */

/**
 * Return true when `error` carries the given surface/replay failure `code`.
 *
 * Non-objects and Errors without `code` are not surface failures; the engine
 * rethrows those so unexpected bugs are not classified as locator misses.
 */
export function hasSurfaceCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}
