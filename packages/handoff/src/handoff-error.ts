/**
 * @file HandoffError — invalid intervention or control-ownership violation.
 */

export class HandoffError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
  }
}
