export type PrimitiveType = "string" | "number" | "boolean" | "date" | "money";

export interface ValueRef { input?: string; literal?: unknown }

export interface TargetDescriptor {
  strategies: Array<{
    type: "roleText" | "label" | "visibleText" | "css" | "xpath" | "relative" | "coordinates";
    role?: string;
    text?: string;
    label?: string;
    selector?: string;
    x?: number;
    y?: number;
    confidence?: number;
  }>;
}

export type Assertion =
  | { type: "textVisible"; value: string | ValueRef }
  | { type: "controlPresent"; target: TargetDescriptor }
  | { type: "valueEquals"; target: TargetDescriptor; value: ValueRef }
  | { type: "urlMatches"; pattern: string }
  | { type: "state"; key: string; value: string | ValueRef };

export type CapabilityAction =
  | { type: "click"; target: TargetDescriptor; intent?: string; risk?: "safe" | "risky" }
  | { type: "fill"; target: TargetDescriptor; value: ValueRef; intent?: string; risk?: "safe" | "risky" }
  | { type: "select"; target: TargetDescriptor; value: ValueRef; intent?: string; risk?: "safe" | "risky" }
  | { type: "navigate"; path: string; intent?: string; risk?: "safe" | "risky" }
  | { type: "read"; target: TargetDescriptor; intent?: string }
  | { type: "handoff"; reason: string };

export interface CapabilityStep {
  id: string;
  description?: string;
  preconditions: Assertion[];
  action: CapabilityAction;
  postconditions: Assertion[];
  timeoutMs?: number;
}

export interface CapabilityArtifact {
  schemaVersion: string;
  capabilityVersion: string;
  id: string;
  name: string;
  description?: string;
  target: { vendor: string; product: string };
  discoveredOn?: { tenant: string; url?: string };
  inputs: Record<string, { type: PrimitiveType; required?: boolean; description?: string }>;
  outputs: Record<string, { type: PrimitiveType; description?: string; extract?: { target: TargetDescriptor } }>;
  steps: CapabilityStep[];
  success: Assertion[];
}

export interface CapabilityRegistry {
  list(): Promise<CapabilityArtifact[]>;
  get(id: string): Promise<CapabilityArtifact | undefined>;
  save(capability: CapabilityArtifact): Promise<void>;
}
