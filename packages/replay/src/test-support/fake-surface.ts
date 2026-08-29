/**
 * @file FakeSurface — in-memory Surface for ReplayEngine unit tests.
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
 * Records calls. Tests configure `assertHandler` / `executeHandler` per case.
 */
export class FakeSurface implements Surface {
  readonly executed: CapabilityAction[] = [];
  readonly asserted: Assertion[] = [];
  observation: Observation = { id: "obs-1", imagePath: "/tmp/fake-screenshot.png" };

  assertHandler: (assertion: Assertion) => boolean | Promise<boolean> = () => true;
  executeHandler: (
    action: CapabilityAction,
  ) => SurfaceActionResult | Promise<SurfaceActionResult> = () => ({ status: "ok" });

  async open(_url: string): Promise<void> {}

  async close(): Promise<void> {}

  async observe(): Promise<Observation> {
    return this.observation;
  }

  async execute(action: CapabilityAction): Promise<SurfaceActionResult> {
    this.executed.push(action);
    return await this.executeHandler(action);
  }

  async assert(assertion: Assertion): Promise<boolean> {
    this.asserted.push(assertion);
    return await this.assertHandler(assertion);
  }

  async locate(_target: TargetDescriptor): Promise<unknown> {
    return { ok: true };
  }

  async peekDestination(_target: TargetDescriptor): Promise<string | undefined> {
    return undefined;
  }

  humanTakes = 0;
  automationResumes = 0;

  async handoffToHuman(): Promise<void> {
    this.humanTakes += 1;
  }

  async resumeFromHuman(): Promise<void> {
    this.automationResumes += 1;
  }
}
