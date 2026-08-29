/**
 * @file Tenant override Zod schema — declarative patches only, never executable code.
 */

import * as z from "zod";

import {
  AssertionSchema,
  CapabilityActionSchema,
  CapabilityStepSchema,
  TargetDescriptorSchema,
} from "./artifact-schema.js";

const SCHEMA_VERSION = "1.0";

const EXECUTABLE_KEY = /javascript|customjs|^eval$|^handler$|^fn$/i;

/**
 * Patch one existing step by id.
 *
 * Supply `step` to replace the whole step, or only the fields that are present.
 * Combining `step` with field-level patches is invalid.
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

export const OverrideProvenanceSchema = z.strictObject({
  createdBy: z.enum(["discovery", "verified", "icas-adapt", "human"]),
  createdFromRun: z.string().min(1).optional(),
  reason: z.string().min(1),
});

/**
 * Tenant specialization of a pinned base capability version (`id@version`).
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
    rejectExecutableKeys(override, [], ctx);
  });

export type StepOverride = z.infer<typeof StepOverrideSchema>;
export type CapabilityOverridePatch = z.infer<
  typeof CapabilityOverridePatchSchema
>;
export type OverrideProvenance = z.infer<typeof OverrideProvenanceSchema>;
export type OverrideProvenanceCreatedBy = OverrideProvenance["createdBy"];
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>;

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
