/**
 * @file Redactor — apply a named profile's patterns to text and nested JSON.
 */

/**
 * One find-and-replace rule inside a profile.
 */
export interface RedactionRule {
  id: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * A named set of redaction rules for one boundary.
 */
export interface RedactionProfile {
  name: string;
  rules: RedactionRule[];
}

/**
 * Mask configured patterns. Unconfigured strings are left unchanged.
 */
export class Redactor {
  constructor(private readonly profile: RedactionProfile) {}

  /**
   * Apply this profile's rules to a string.
   */
  redactText(value: string): string {
    return this.profile.rules.reduce((result, rule) => {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      return result.replace(pattern, rule.replacement);
    }, value);
  }

  /**
   * Recursively redact strings inside JSON-like values.
   *
   * @returns A new structure; primitives other than strings are unchanged
   */
  redactValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.redactText(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item));
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).map(([key, nested]) => [
        key,
        this.redactValue(nested),
      ]);
      return Object.fromEntries(entries);
    }
    return value;
  }
}
