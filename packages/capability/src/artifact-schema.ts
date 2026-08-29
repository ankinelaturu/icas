/**
 * @file Capability artifact Zod schema — runtime contract for base capability JSON.
 */

import * as z from "zod";

const SCHEMA_VERSION = "1.0";

/**
 * Reference a typed invocation input or a literal value.
 *
 * Exactly one of `input` or `literal` is required.
 */
export const ValueRefSchema = z
  .strictObject({
    input: z.string().min(1).optional(),
    literal: z.unknown().optional(),
  })
  .refine(
    (ref) =>
      (ref.input !== undefined) !== (ref.literal !== undefined),
    { error: "ValueRef must have exactly one of input or literal" },
  );

const TargetStrategySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("roleText"),
    role: z.string().min(1),
    text: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("label"),
    label: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("visibleText"),
    text: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("css"),
    selector: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("xpath"),
    selector: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("relative"),
    text: z.string().min(1),
    role: z.string().min(1).optional(),
    xpath: z.string().min(1).optional(),
    confidence: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("coordinates"),
    x: z.number(),
    y: z.number(),
    confidence: z.number().optional(),
  }),
]);

/**
 * Ranked locator strategies for one control.
 */
export const TargetDescriptorSchema = z.strictObject({
  strategies: z.array(TargetStrategySchema).min(1),
});

const textOrValueRef = z.union([z.string().min(1), ValueRefSchema]);

/**
 * Expected UI or domain state used as a checkpoint.
 */
export const AssertionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("textVisible"),
    value: textOrValueRef,
  }),
  z.strictObject({
    type: z.literal("controlPresent"),
    target: TargetDescriptorSchema,
  }),
  z.strictObject({
    type: z.literal("valueEquals"),
    target: TargetDescriptorSchema,
    value: ValueRefSchema,
  }),
  z.strictObject({
    type: z.literal("urlMatches"),
    pattern: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("state"),
    key: z.string().min(1),
    value: textOrValueRef,
  }),
]);

const riskSchema = z.enum(["safe", "risky"]);

/**
 * Semantic action vocabulary. Unknown `type` values fail validation.
 */
export const CapabilityActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("click"),
    target: TargetDescriptorSchema,
    intent: z.string().min(1).optional(),
    risk: riskSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("fill"),
    target: TargetDescriptorSchema,
    value: ValueRefSchema,
    intent: z.string().min(1).optional(),
    risk: riskSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("select"),
    target: TargetDescriptorSchema,
    value: ValueRefSchema,
    intent: z.string().min(1).optional(),
    risk: riskSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("navigate"),
    path: z.string().min(1),
    intent: z.string().min(1).optional(),
    risk: riskSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("read"),
    target: TargetDescriptorSchema,
    intent: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal("handoff"),
    reason: z.string().min(1),
  }),
]);

const inputParamSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  required: z.boolean().optional(),
  description: z.string().min(1).optional(),
});

const outputParamSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  description: z.string().min(1).optional(),
  extract: z.strictObject({ target: TargetDescriptorSchema }).optional(),
});

/**
 * One ordered step with preconditions, action, and postconditions.
 */
export const CapabilityStepSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  preconditions: z.array(AssertionSchema),
  action: CapabilityActionSchema,
  postconditions: z.array(AssertionSchema),
  timeoutMs: z.number().positive().optional(),
});

/**
 * Base capability artifact. `schemaVersion` is the JSON format; `capabilityVersion`
 * is the learned flow (semver).
 */
export const CapabilityArtifactSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION, {
      error: `schemaVersion must be "${SCHEMA_VERSION}" (artifact format), not capabilityVersion`,
    }),
    capabilityVersion: z.string().regex(/^\d+\.\d+\.\d+$/, {
      error:
        'capabilityVersion must be a three-part semver such as "1.0.0", not schemaVersion',
    }),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    target: z.strictObject({
      vendor: z.string().min(1),
      product: z.string().min(1),
    }),
    discoveredOn: z
      .strictObject({
        tenant: z.string().min(1),
        url: z.string().min(1).optional(),
      })
      .optional(),
    inputs: z.record(z.string().min(1), inputParamSchema),
    outputs: z.record(z.string().min(1), outputParamSchema),
    steps: z.array(CapabilityStepSchema).min(1),
    success: z.array(AssertionSchema).min(1),
  })
  .superRefine((artifact, ctx) => {
    const seen = new Set<string>();
    for (const [index, step] of artifact.steps.entries()) {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: `duplicate step id "${step.id}"`,
        });
      }
      seen.add(step.id);
    }
  });

export type ValueRef = z.infer<typeof ValueRefSchema>;
export type TargetDescriptor = z.infer<typeof TargetDescriptorSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;
export type CapabilityAction = z.infer<typeof CapabilityActionSchema>;
export type CapabilityStep = z.infer<typeof CapabilityStepSchema>;
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
export type PrimitiveType = z.infer<typeof inputParamSchema>["type"];
