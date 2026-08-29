/**
 * @file SurfaceError — structured failures from the browser surface.
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
