export interface RedactionRule {
  id: string;
  pattern: RegExp;
  replacement: string;
}

export interface RedactionProfile {
  name: string;
  rules: RedactionRule[];
}

export class Redactor {
  constructor(private readonly profile: RedactionProfile) {}

  redactText(value: string): string {
    return this.profile.rules.reduce(
      (result, rule) => result.replace(rule.pattern, rule.replacement),
      value,
    );
  }
}
