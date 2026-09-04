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

  async visibleText(): Promise<string> {
    return "";
  }

  async locate(_target: TargetDescriptor): Promise<unknown> {
    return { ok: true };
  }

  async peekDestination(_target: TargetDescriptor): Promise<string | undefined> {
    return undefined;
  }

  /**
   * Tests set {@link snapshotRefTarget} when a candidate carries `snapshotRef`.
   */
  snapshotRefTarget: TargetDescriptor = {
    strategies: [{ type: "roleText", role: "link", text: "Lending" }],
  };
  /**
   * When set, {@link bindSnapshotRef} throws so tests can cover describe-miss.
   */
  bindError: Error | undefined;
  /**
   * When set, {@link executeSnapshotRef} throws so tests can cover locator fallback.
   */
  executeSnapshotRefError: Error | undefined;
  readonly boundRefs: string[] = [];
  readonly executedRefs: string[] = [];
  readonly peekedRefs: string[] = [];

  async bindSnapshotRef(ref: string): Promise<TargetDescriptor> {
    this.boundRefs.push(ref);
    if (this.bindError !== undefined) {
      throw this.bindError;
    }
    return this.snapshotRefTarget;
  }

  async peekSnapshotRef(ref: string): Promise<string | undefined> {
    this.peekedRefs.push(ref);
    return undefined;
  }

  async executeSnapshotRef(
    ref: string,
    action: CapabilityAction,
  ): Promise<SurfaceActionResult> {
    this.executedRefs.push(ref);
    if (this.executeSnapshotRefError !== undefined) {
      throw this.executeSnapshotRefError;
    }
    return await this.execute(action);
  }

  async handoffToHuman(): Promise<void> {}

  async resumeFromHuman(): Promise<void> {}
}
