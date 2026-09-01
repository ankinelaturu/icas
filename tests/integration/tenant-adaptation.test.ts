/**
 * @file Tenant adaptation against HTML fixtures (Loki label drift).
 *
 * Full Loki Bank app is Phase 7. This fixture only changes "Lending" to
 * "Member Lending" on the home page so guarded replay fails at a known step.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGuardedAdapt } from "../../apps/icas-adapt/src/adapt-session.js";
import {
  FileSystemCapabilityRegistry,
  validateCapabilityArtifact,
} from "../../packages/capability/src/index.js";

import { pageUrl } from "./fixture-pages.js";

const miniLending = validateCapabilityArtifact({
  schemaVersion: "1.0",
  id: "open-lending",
  name: "Open Lending",
  target: { vendor: "icas-bank", product: "icas-bank" },
  inputs: {},
  outputs: {},
  steps: [
    {
      id: "open-lending",
      preconditions: [{ type: "textVisible", value: "Home" }],
      action: {
        type: "click",
        target: {
          strategies: [
            { type: "roleText", role: "button", text: "Lending" },
            { type: "visibleText", text: "Lending" },
          ],
        },
        intent: "Open lending services",
        risk: "safe",
      },
      postconditions: [{ type: "textVisible", value: "Lending Services" }],
    },
  ],
  success: [{ type: "textVisible", value: "Lending Services" }],
});

describe("tenant-adaptation integration", () => {
  it(
    "specializes the Lending click for Member Lending and re-verifies",
    async () => {
    const root = await mkdtemp(join(tmpdir(), "icas-adapt-int-"));
    const evidenceRoot = await mkdtemp(join(tmpdir(), "icas-adapt-ev-"));
    const registry = new FileSystemCapabilityRegistry({ root });
    try {
      await registry.save(miniLending);
      const { report, override } = await runGuardedAdapt(
        {
          id: "open-lending",
          url: pageUrl("loki-home.html"),
          tenant: "loki-bank",
          vendor: "icas-bank",
          product: "icas-bank",
          inputs: {},
          headed: false,
          timeoutMs: 2_500,
        },
        {
          registry,
          evidenceRoot,
          specializer: {
            async specialize() {
              return {
                target: {
                  strategies: [
                    { type: "roleText", role: "button", text: "Member Lending" },
                    { type: "visibleText", text: "Member Lending" },
                  ],
                },
              };
            },
          },
        },
      );
      expect(report.status).toBe("mismatch");
      expect(report.status === "mismatch" && report.stepId).toBe("open-lending");
      expect(override?.provenance.createdBy).toBe("icas-adapt");
      const enrolled = await registry.listOverrides({ tenant: "loki-bank" });
      expect(enrolled).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(evidenceRoot, { recursive: true, force: true });
    }
    },
    60_000,
  );
});
