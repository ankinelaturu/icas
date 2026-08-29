/**
 * @file Capability artifact types — the serializable JSON contract for a reusable flow.
 */

/**
 * Primitive types accepted for capability inputs and extracted outputs.
 */
export type PrimitiveType = "string" | "number" | "boolean" | "date" | "money";

/**
 * Reference a typed invocation input or a literal value.
 *
 * Exactly one of `input` or `literal` is required at validation time.
 */
export interface ValueRef {
  input?: string;
  literal?: unknown;
}

/**
 * Ranked locator strategies for one control. Replay tries them in order.
 */
export interface TargetDescriptor {
  strategies: Array<{
    type:
      | "roleText"
      | "label"
      | "visibleText"
      | "css"
      | "xpath"
      | "relative"
      | "coordinates";
    role?: string;
    text?: string;
    label?: string;
    selector?: string;
    x?: number;
    y?: number;
    confidence?: number;
  }>;
}

/**
 * Expected UI or domain state. Used as a step precondition, postcondition, or
 * overall success check.
 */
export type Assertion =
  | { type: "textVisible"; value: string | ValueRef }
  | { type: "controlPresent"; target: TargetDescriptor }
  | { type: "valueEquals"; target: TargetDescriptor; value: ValueRef }
  | { type: "urlMatches"; pattern: string }
  | { type: "state"; key: string; value: string | ValueRef };

/**
 * One semantic action against the surface. Playwright is the first mapping,
 * not part of this contract.
 */
export type CapabilityAction =
  | {
      type: "click";
      target: TargetDescriptor;
      intent?: string;
      risk?: "safe" | "risky";
    }
  | {
      type: "fill";
      target: TargetDescriptor;
      value: ValueRef;
      intent?: string;
      risk?: "safe" | "risky";
    }
  | {
      type: "select";
      target: TargetDescriptor;
      value: ValueRef;
      intent?: string;
      risk?: "safe" | "risky";
    }
  | {
      type: "navigate";
      path: string;
      intent?: string;
      risk?: "safe" | "risky";
    }
  | { type: "read"; target: TargetDescriptor; intent?: string }
  | { type: "handoff"; reason: string };

/**
 * One ordered step: verify preconditions, perform an action, verify postconditions.
 */
export interface CapabilityStep {
  id: string;
  description?: string;
  preconditions: Assertion[];
  action: CapabilityAction;
  postconditions: Assertion[];
  timeoutMs?: number;
}

/**
 * Typed, versioned, serializable contract for a Vendor+Product business operation.
 *
 * Tenant identity belongs on a {@link CapabilityOverride}, not on this reusable base.
 */
export interface CapabilityArtifact {
  schemaVersion: string;
  capabilityVersion: string;
  id: string;
  name: string;
  description?: string;
  target: { vendor: string; product: string };
  discoveredOn?: { tenant: string; url?: string };
  inputs: Record<
    string,
    { type: PrimitiveType; required?: boolean; description?: string }
  >;
  outputs: Record<
    string,
    {
      type: PrimitiveType;
      description?: string;
      extract?: { target: TargetDescriptor };
    }
  >;
  steps: CapabilityStep[];
  success: Assertion[];
}
