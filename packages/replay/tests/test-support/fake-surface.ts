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
 * Set `visibleTextContent` for possibleOutcomes scans (not `assertHandler`).
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

  /**
   * Snapshot of the current view. Tests set {@link visibleTextContent}.
   */
  visibleTextContent = "";

  async visibleText(): Promise<string> {
    return this.visibleTextContent;
  }

  async locate(_target: TargetDescriptor): Promise<unknown> {
    return await this.locateHandler(_target);
  }

  locateHandler: (target: TargetDescriptor) => unknown | Promise<unknown> = () => ({
    ok: true,
  });

  async peekDestination(_target: TargetDescriptor): Promise<string | undefined> {
    return undefined;
  }

  async bindSnapshotRef(_ref: string): Promise<TargetDescriptor> {
    return { strategies: [{ type: "visibleText", text: "unused" }] };
  }

  async peekSnapshotRef(_ref: string): Promise<string | undefined> {
    return undefined;
  }

  async executeSnapshotRef(
    _ref: string,
    action: CapabilityAction,
  ): Promise<SurfaceActionResult> {
    return await this.execute(action);
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
