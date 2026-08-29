/**
 * @file SurfaceError — structured failures from the browser surface.
 *
 * `code` is a string token shared with {@link ReplayFailureCode} (e.g.
 * `TARGET_NOT_FOUND`). Replay duck-types the field so it does not import
 * this package.
 */

/**
 * A surface operation failed. `code` matches the replay taxonomy where applicable.
 */
export class SurfaceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "SurfaceError";
  }
}
