import type { Surface, Observation, SurfaceActionResult } from "@icas/surface";
import type { CapabilityAction, Assertion, TargetDescriptor } from "@icas/capability";

export class PlaywrightSurface implements Surface {
  async open(_url: string): Promise<void> {
    throw new Error("PlaywrightSurface.open is a scaffold.");
  }
  async observe(): Promise<Observation> {
    throw new Error("PlaywrightSurface.observe is a scaffold.");
  }
  async execute(_action: CapabilityAction): Promise<SurfaceActionResult> {
    throw new Error("PlaywrightSurface.execute is a scaffold.");
  }
  async assert(_assertion: Assertion): Promise<boolean> {
    throw new Error("PlaywrightSurface.assert is a scaffold.");
  }
  async locate(_target: TargetDescriptor): Promise<unknown> {
    throw new Error("PlaywrightSurface.locate is a scaffold.");
  }
  async handoffToHuman(): Promise<void> {
    throw new Error("PlaywrightSurface.handoffToHuman is a scaffold.");
  }
}
