import type { CapabilityAction, Assertion, TargetDescriptor } from "@icas/capability";

export interface Observation {
  id: string;
  url?: string;
  imagePath?: string;
  accessibilitySnapshot?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SurfaceActionResult {
  status: "ok" | "blocked" | "failed";
  details?: unknown;
}

export interface Surface {
  open(url: string): Promise<void>;
  observe(): Promise<Observation>;
  execute(action: CapabilityAction): Promise<SurfaceActionResult>;
  assert(assertion: Assertion): Promise<boolean>;
  locate(target: TargetDescriptor): Promise<unknown>;
  handoffToHuman(): Promise<void>;
}
