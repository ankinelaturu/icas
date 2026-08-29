/**
 * @file Tenant override Zod schema — declarative patches only, never executable code.
 *
 * An override is enrollment plus an optional patch against a pinned
 * `id@version`. `strictObject` rejects unknown keys so a hand-edit cannot
 * smuggle a `handler` or extra locator field. Discriminated action/assertion
 * schemas are reused from the base artifact so a patch step is the same
 * vocabulary replay already executes.
 */

import * as z from "zod";

import {
  AssertionSchema,
  CapabilityActionSchema,
  CapabilityStepSchema,
  TargetDescriptorSchema,
} from "./artifact-schema.js";

/** Same format id as the base artifact. Independent of the pinned capabilityVersion. */
const SCHEMA_VERSION = "1.0";

/** Key names that look like injectable code. Matched case-insensitively on every nested object. */
const EXECUTABLE_KEY = /javascript|customjs|^eval$|^handler$|^fn$/i;

/**
 * Patch one existing step by id.
 *
 * Supply `step` to replace the whole step, or only the fields that are present.
 * Combining `step` with field-level patches is invalid.
 *
 * XOR exists because a whole-step replace already carries target/action; merging
 * both would leave apply order undefined (which wins?). Empty patches are also
 * invalid — enrollment with no step change uses `overrides: {}`, not a no-op
 * StepOverride.
 */
export const StepOverrideSchema = z
  .strictObject({
    step: CapabilityStepSchema.optional(),
    target: TargetDescriptorSchema.optional(),
    action: CapabilityActionSchema.optional(),
    preconditions: z.array(AssertionSchema).optional(),
    postconditions: z.array(AssertionSchema).optional(),
  })
  .superRefine((patch, ctx) => {
    const hasWhole = patch.step !== undefined;
    const hasFields =
      patch.target !== undefined ||
      patch.action !== undefined ||
      patch.preconditions !== undefined ||
      patch.postconditions !== undefined;
    if (hasWhole && hasFields) {
      ctx.addIssue({
        code: "custom",
        message:
          "StepOverride cannot combine a whole-step replace with field-level patches",
      });
    }
    if (!hasWhole && !hasFields) {
      ctx.addIssue({
        code: "custom",
        message:
          "StepOverride must replace the whole step or at least one of target, action, preconditions, postconditions",
      });
    }
  });

/**
 * Declarative operations applied to a base capability. `{}` is header-only enrollment.
 *
 * Header-only is the edit surface for later tweaks so operators never patch
 * `1.0.0.json` when they mean one institution. Insert keys are existing step
 * ids; new steps live in the arrays, not as new record keys.
 */
export const CapabilityOverridePatchSchema = z.strictObject({
  steps: z.record(z.string().min(1), StepOverrideSchema).optional(),
  insertBefore: z
    .record(z.string().min(1), z.array(CapabilityStepSchema).min(1))
    .optional(),
  insertAfter: z
    .record(z.string().min(1), z.array(CapabilityStepSchema).min(1))
    .optional(),
  disabledSteps: z.array(z.string().min(1)).optional(),
});

/**
 * Who wrote the override and why.
 *
 * `createdBy` distinguishes first discover, compatible adapt, drifted adapt,
 * and a human edit. An empty patch is not proof the UI still works —
 * `createdFromRun` should point at the verifying replay.
 */
export const OverrideProvenanceSchema = z.strictObject({
  createdBy: z.enum(["discovery", "verified", "icas-adapt", "human"]),
  createdFromRun: z.string().min(1).optional(),
  reason: z.string().min(1),
});

/**
 * Tenant specialization of a pinned base capability version (`id@version`).
 *
 * Pin the version in `baseCapability` so a later `2.0.0` base cannot silently
 * inherit a `1.0.0` patch. `target.tenant` is enrollment identity; it is not
 * part of the reusable Vendor+Product id.
 */
export const CapabilityOverrideSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION, {
      error: `schemaVersion must be "${SCHEMA_VERSION}"`,
    }),
    id: z.string().min(1),
    baseCapability: z.string().regex(/^[A-Za-z0-9._-]+@\d+\.\d+\.\d+$/, {
      error:
        'baseCapability must pin a version, e.g. "loan-payoff@1.0.0"',
    }),
    target: z.strictObject({
      tenant: z.string().min(1),
    }),
    overrides: CapabilityOverridePatchSchema,
    provenance: OverrideProvenanceSchema,
  })
  .superRefine((override, ctx) => {
    // Walk the whole value so a nested `handler` key cannot hide under a step.
    rejectExecutableKeys(override, [], ctx);
  });

export type StepOverride = z.infer<typeof StepOverrideSchema>;
export type CapabilityOverridePatch = z.infer<
  typeof CapabilityOverridePatchSchema
>;
export type OverrideProvenance = z.infer<typeof OverrideProvenanceSchema>;
export type OverrideProvenanceCreatedBy = OverrideProvenance["createdBy"];
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>;

/**
 * Recursively refuse function values and keys that look like injectable code.
 *
 * Overrides must stay reviewable JSON. A `customJs` field would break the
 * "replay has no LLM and no eval" invariant even if Zod's object shape allowed it.
 */
function rejectExecutableKeys(
  value: unknown,
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): void {
  if (typeof value === "function") {
    ctx.addIssue({
      code: "custom",
      path,
      message: "executable patches are not allowed",
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      rejectExecutableKeys(item, [...path, index], ctx);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (EXECUTABLE_KEY.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message:
          "executable patches are not allowed; overrides must be declarative data",
      });
    }
    rejectExecutableKeys(nested, [...path, key], ctx);
  }
}
