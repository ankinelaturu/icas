/**
 * @file HandoffError — invalid intervention or control-ownership violation.
 *
 * Machine-readable `code` lets callers distinguish "human already owns the
 * session" from a malformed request without parsing `message`.
 */

/**
 * Thrown when HITL ownership is violated or an intervention cannot be accepted.
 */
export class HandoffError extends Error {
  readonly code: string;

  /**
   * @param message - Operator-facing explanation
   * @param code - Stable token such as `HUMAN_HAS_CONTROL` or `INVALID_INTERVENTION`
   */
  constructor(message: string, code: string) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
  }
}
