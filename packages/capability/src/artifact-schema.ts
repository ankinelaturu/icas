/**
 * @file Capability artifact Zod schema — runtime contract for base capability JSON.
 *
 * This is the Vendor+Product base, not a tenant copy. Tenant differences live
 * on a separate override file. `strictObject` rejects unknown keys so LLM dumps
 * and hand-edits cannot smuggle extra fields into the catalog. Discriminated
 * unions on `type` keep action, assertion, and locator fields mutually
 * exclusive; an unknown `type` fails validation instead of reaching replay.
 */

import * as z from "zod";

/** JSON format id. Distinct from `capabilityVersion` (the learned flow). */
const SCHEMA_VERSION = "1.0";

/**
 * Reference a typed invocation input or a literal value.
 *
 * Exactly one of `input` or `literal` is required. Discovery must replace
 * recorded concrete values with `{ input: "…" }` so replay stays parameterized.
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

/**
 * Ranked locator strategies for one control.
 *
 * Discriminated on `type` so each strategy carries only its own fields
 * (`roleText` has `role`+`text`, `css` has `selector`). A flat optional-field
 * object would accept invalid combinations. Replay tries strategies in array
 * order; `coordinates` is last-resort only.
 */
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
 *
 * Replay tries `strategies` in order. Keep more than one so a CSS fallback
 * exists when the accessible name drifts.
 */
export const TargetDescriptorSchema = z.strictObject({
  strategies: z.array(TargetStrategySchema).min(1),
});

/** Allow a bare string or a parameterized {@link ValueRefSchema}. */
const textOrValueRef = z.union([z.string().min(1), ValueRefSchema]);

/**
 * Expected UI or domain state used as a checkpoint.
 *
 * Discriminated on `type` so a `textVisible` cannot also carry a `target`.
 * Preconditions ask "is this step safe to run"; postconditions ask "did the
 * action produce the expected result." Encode meaningful state, not screenshot
 * equality.
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

/** Mutating actions may mark risk; policy reads this, the schema does not enforce it. */
const riskSchema = z.enum(["safe", "risky"]);

/**
 * Semantic action vocabulary. Unknown `type` values fail validation.
 *
 * Discriminated on `type` so `click` requires a target and `navigate` a path.
 * The vocabulary is surface-agnostic: Playwright is the first mapping, not the
 * artifact model. `handoff` transfers the same headed session, not a new flow.
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

/** Typed invocation parameter. Discovery must not bake recorded literals here. */
const inputParamSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  required: z.boolean().optional(),
  description: z.string().min(1).optional(),
});

/** Declared output plus optional extract target. Replay type-checks extracted values. */
const outputParamSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean", "date", "money"]),
  description: z.string().min(1).optional(),
  extract: z.strictObject({ target: TargetDescriptorSchema }).optional(),
});

/**
 * One ordered step with preconditions, action, and postconditions.
 *
 * `id` is the stable patch key for tenant overrides. Keep it unique across the
 * artifact so `applyCapabilityOverride` can address a step without indexes.
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
 *
 * `target` is Vendor+Product identity. `discoveredOn` is provenance only — do
 * not treat tenant URL as reusable identity. `success` is the overall checkpoint,
 * distinct from the last step's postconditions.
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
        // Duplicate ids make tenant patches ambiguous (which step gets the patch?).
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
