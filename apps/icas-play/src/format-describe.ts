/**
 * @file Human-readable capability summary for `icas-play describe`.
 *
 * Operators should not have to read raw JSON to see inputs, steps, and
 * success conditions.
 */

import type { Assertion, CapabilityAction, CapabilityArtifact } from "@icas/capability";

/**
 * Format one artifact as labeled sections.
 *
 * @param artifact - Catalog row from {@link CapabilityRegistry.get}
 */
export function formatCapabilityDescription(artifact: CapabilityArtifact): string {
  const lines: string[] = [
    `id: ${artifact.id}`,
    `name: ${artifact.name}`,
    `schemaVersion: ${artifact.schemaVersion}`,
    `capabilityVersion: ${artifact.capabilityVersion}`,
    `target: ${artifact.target.vendor} / ${artifact.target.product}`,
  ];
  // discoveredOn is optional on older fixtures; omit the section rather than print "undefined".
  if (artifact.discoveredOn !== undefined) {
    const url =
      artifact.discoveredOn.url === undefined
        ? ""
        : ` url=${artifact.discoveredOn.url}`;
    lines.push(`discoveredOn: tenant=${artifact.discoveredOn.tenant}${url}`);
  }
  if (artifact.description !== undefined) {
    lines.push(`description: ${artifact.description}`);
  }
  lines.push("inputs:");
  const inputNames = Object.keys(artifact.inputs);
  if (inputNames.length === 0) {
    lines.push("  (none)");
  } else {
    for (const name of inputNames) {
      const param = artifact.inputs[name];
      // noUncheckedIndexedAccess: Object.keys does not prove the record lookup.
      if (param === undefined) {
        continue;
      }
      // Schema default is optional; only `required: true` is mandatory at run time.
      const required = param.required === true ? "required" : "optional";
      const desc = param.description === undefined ? "" : ` — ${param.description}`;
      lines.push(`  ${name}: ${param.type} (${required})${desc}`);
    }
  }
  lines.push("outputs:");
  const outputNames = Object.keys(artifact.outputs);
  if (outputNames.length === 0) {
    lines.push("  (none)");
  } else {
    for (const name of outputNames) {
      const param = artifact.outputs[name];
      if (param === undefined) {
        continue;
      }
      const desc = param.description === undefined ? "" : ` — ${param.description}`;
      lines.push(`  ${name}: ${param.type}${desc}`);
    }
  }
  lines.push("steps:");
  for (const step of artifact.steps) {
    const intent =
      "intent" in step.action && step.action.intent !== undefined
        ? ` (${step.action.intent})`
        : "";
    lines.push(`  ${step.id}: ${summarizeAction(step.action)}${intent}`);
    if (step.preconditions.length > 0) {
      lines.push(`    pre: ${step.preconditions.map(summarizeAssertion).join("; ")}`);
    }
    if (step.postconditions.length > 0) {
      lines.push(`    post: ${step.postconditions.map(summarizeAssertion).join("; ")}`);
    }
  }
  lines.push("success:");
  for (const assertion of artifact.success) {
    lines.push(`  ${summarizeAssertion(assertion)}`);
  }
  return lines.join("\n");
}

function summarizeAction(action: CapabilityAction): string {
  if (action.type === "handoff") {
    return `handoff (${action.reason})`;
  }
  if (action.type === "navigate") {
    return `navigate ${action.path}`;
  }
  if (action.type === "fill" || action.type === "select") {
    // Prefer the input name over a discovery-time literal so operators see the contract.
    const ref =
      action.value.input !== undefined
        ? `input:${action.value.input}`
        : `literal:${String(action.value.literal)}`;
    return `${action.type} ${firstLocator(action)} = ${ref}`;
  }
  return `${action.type} ${firstLocator(action)}`;
}

function firstLocator(action: CapabilityAction): string {
  // Handoff / navigate have no TargetDescriptor; skip rather than throw.
  if (!("target" in action)) {
    return "";
  }
  const first = action.target.strategies[0];
  if (first === undefined) {
    return "";
  }
  if ("text" in first && typeof first.text === "string") {
    return first.text;
  }
  if ("label" in first && typeof first.label === "string") {
    return first.label;
  }
  if ("selector" in first && typeof first.selector === "string") {
    return first.selector;
  }
  return first.type;
}

function summarizeAssertion(assertion: Assertion): string {
  if (assertion.type === "textVisible") {
    return `textVisible ${JSON.stringify(assertion.value)}`;
  }
  if (assertion.type === "urlMatches") {
    return `urlMatches ${assertion.pattern}`;
  }
  if (assertion.type === "controlPresent") {
    return "controlPresent";
  }
  if (assertion.type === "valueEquals") {
    return "valueEquals";
  }
  return `state ${assertion.key}`;
}
