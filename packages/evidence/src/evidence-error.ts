/**
 * @file EvidenceError — invalid evidence path or writer arguments.
 */

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/**
 * Reject empty ids and path separators so evidence stays under the given root.
 */
export function assertEvidenceSegment(value: string, label: string): string {
  if (value.length === 0 || value === "." || value === ".." || /[/\\]/.test(value)) {
    throw new EvidenceError(`${label} is not a safe path segment.`);
  }
  return value;
}
