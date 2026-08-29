/**
 * @file FakeSurface — in-memory Surface for discovery unit tests.
 */

import type {
  Assertion,
  CapabilityAction,
  TargetDescriptor,
} from "@icas/capability";
import type {
  Observation,
  Surface,
  SurfaceActionResult,
} from "@icas/surface";

/**
 * Records calls. Tests set `observation` and `executeHandler`.
 */
export class FakeSurface implements Surface {
  readonly executed: CapabilityAction[] = [];
  observation: Observation = { id: "obs-1" };
  openedUrl: string | undefined;
  readonly opens: string[] = [];

  executeHandler: (
    action: CapabilityAction,
  ) => SurfaceActionResult | Promise<SurfaceActionResult> = () => ({ status: "ok" });

  async open(url: string): Promise<void> {
    this.openedUrl = url;
    this.opens.push(url);
  }

  async close(): Promise<void> {}

  async observe(): Promise<Observation> {
    return this.observation;
  }

  async execute(action: CapabilityAction): Promise<SurfaceActionResult> {
    this.executed.push(action);
    return await this.executeHandler(action);
  }

  async assert(_assertion: Assertion): Promise<boolean> {
    return true;
  }

  async locate(_target: TargetDescriptor): Promise<unknown> {
    return { ok: true };
  }

  async peekDestination(_target: TargetDescriptor): Promise<string | undefined> {
    return undefined;
  }

  async handoffToHuman(): Promise<void> {}

  async resumeFromHuman(): Promise<void> {}
}
