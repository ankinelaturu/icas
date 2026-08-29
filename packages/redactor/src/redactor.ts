/**
 * @file Redactor — apply a named profile's patterns to text and nested JSON.
 *
 * Redaction is independent of PolicyGuard: allow / deny / require-human
 * decide execution; this class decides what may leave memory. Callers redact
 * before persist and before sending observations to a model.
 *
 * @see redactionProfile
 * @see createRedactor
 */

/**
 * One find-and-replace rule inside a profile.
 *
 * `id` is for reviews and tests, not applied as a pattern.
 */
export interface RedactionRule {
  id: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * A named set of redaction rules for one boundary.
 *
 * Model, evidence, and terminal profiles differ because each egress is willing
 * to leak a different amount. Do not reuse one denylist for all three.
 */
export interface RedactionProfile {
  name: string;
  rules: RedactionRule[];
}

/**
 * Mask configured patterns. Unconfigured strings are left unchanged.
 *
 * Synthetic tenants have no real PII, but skipping redaction would normalize
 * unsafe persistence. Profiles are injected so tests can use a tighter set.
 */
export class Redactor {
  constructor(private readonly profile: RedactionProfile) {}

  /**
   * Apply this profile's rules to a string.
   *
   * Clone each regex before `replace`. A shared `/g` pattern would retain
   * `lastIndex` and skip later strings in the same process.
   *
   * @param value - Raw text that may contain identifiers
   * @returns `value` with every matching rule substituted
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
   * Returns a new structure so the in-memory observation can still drive the
   * headed session. Object keys are schema, not payload, and are left intact.
   * Non-string primitives pass through unchanged.
   *
   * @param value - String, array, plain object, or primitive
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
