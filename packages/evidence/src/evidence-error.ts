/**
 * @file EvidenceError — invalid evidence path or writer arguments.
 *
 * Path segments are validated so a capability id cannot walk out of the
 * evidence root. Fail closed before mkdir/write.
 */

/**
 * Thrown when a run cannot be written under the configured evidence root.
 */
export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/**
 * Reject empty ids and path separators so evidence stays under the given root.
 *
 * `.` and `..` would collide with layout or escape `root`. Slashes would
 * create extra directories the catalog did not name.
 *
 * @param value - Capability id or run id used as a directory name
 * @param label - Field name in the thrown message
 * @returns The same `value` when it is a single safe segment
 * @throws {EvidenceError} When `value` is empty, `.`, `..`, or contains a slash
 */
export function assertEvidenceSegment(value: string, label: string): string {
  if (value.length === 0 || value === "." || value === ".." || /[/\\]/.test(value)) {
    throw new EvidenceError(`${label} is not a safe path segment.`);
  }
  return value;
}
