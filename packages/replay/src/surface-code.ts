/**
 * @file surface-code — detect structured SurfaceError codes without importing @icas/browser.
 */

/**
 * Return true when `error` carries the given surface/replay failure `code`.
 */
export function hasSurfaceCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}
