/**
 * @file IcasLlmSettings — resolve per-flow LLM transport from env.
 *
 * Discover, `--assist`, and `icas-adapt` each have their own `ICAS_*_LLM_*`
 * prefix so operators can point them at different hosts. Env is model
 * transport only; {@link CandidateProposer} / RepairProposer /
 * StepSpecializer stay the SDK seam.
 *
 * Empty `BASE_URL` means the provider's public host. The provider prefix on
 * `MODEL` (`openai/…`, `anthropic/…`) selects the public host; do not infer
 * it from any other env name.
 */

/** Default `provider/model` when no explicit model id is set. Vision-capable. */
export const DEFAULT_ICAS_LLM_MODEL = "openai/gpt-4o";

/**
 * Which CLI flow to resolve.
 *
 * `discovery` → `ICAS_DISCOVERY_LLM_*`. `assist` → `ICAS_ASSIST_LLM_*`.
 * `adapt` → `ICAS_ADAPT_LLM_*`.
 */
export type IcasLlmFlow = "discovery" | "assist" | "adapt";

/**
 * Env prefix for one flow. Callers must not concatenate ad-hoc names.
 *
 * @param flow - Discover, assist, or adapt
 */
function envPrefix(flow: IcasLlmFlow): string {
  switch (flow) {
    case "discovery":
      return "ICAS_DISCOVERY_LLM";
    case "assist":
      return "ICAS_ASSIST_LLM";
    case "adapt":
      return "ICAS_ADAPT_LLM";
  }
}

/**
 * Resolved LLM transport for one generate call.
 *
 * Optional sampling fields are omitted when the env var is empty so the
 * provider default applies.
 */
export interface IcasLlmSettings {
  /** Mastra `provider/model` id, e.g. `openai/gpt-4o`. */
  model: string;
  /** Credential. Omitted when unset. */
  apiKey?: string;
  /** OpenAI-compatible HTTP root including `/v1`. Omitted when unset. */
  baseUrl?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
}

/**
 * True when a live generate can run.
 *
 * Requires a model id and either a key or a base URL (local / gateway).
 */
export function isIcasLlmReady(settings: IcasLlmSettings): boolean {
  if (settings.model.length === 0) {
    return false;
  }
  const hasKey = settings.apiKey !== undefined && settings.apiKey.length > 0;
  const hasUrl = settings.baseUrl !== undefined && settings.baseUrl.length > 0;
  return hasKey || hasUrl;
}

/**
 * Load settings for one flow from `env`.
 *
 * Reads only `ICAS_<FLOW>_LLM_*`. Empty strings are unset.
 *
 * @param flow - Discovery, assist, or adapt prefix
 * @param env - Process env; inject in tests
 */
export function resolveIcasLlmSettings(
  flow: IcasLlmFlow,
  env: NodeJS.ProcessEnv = process.env,
): IcasLlmSettings {
  const prefix = envPrefix(flow);
  const model = firstNonEmpty(env[`${prefix}_MODEL`]) ?? DEFAULT_ICAS_LLM_MODEL;
  const apiKey = firstNonEmpty(env[`${prefix}_API_KEY`]);
  const baseUrl = firstNonEmpty(env[`${prefix}_BASE_URL`]);
  const temperature = parseOptionalNumber(`${prefix}_TEMPERATURE`, env[`${prefix}_TEMPERATURE`], {
    allowZero: true,
  });
  const topK = parseOptionalNumber(`${prefix}_TOP_K`, env[`${prefix}_TOP_K`], {
    allowZero: false,
  });
  const topP = parseOptionalNumber(`${prefix}_TOP_P`, env[`${prefix}_TOP_P`], {
    allowZero: false,
  });
  const maxOutputTokens = parseOptionalNumber(
    `${prefix}_MAX_OUTPUT_TOKENS`,
    env[`${prefix}_MAX_OUTPUT_TOKENS`],
    { allowZero: false },
  );
  return {
    model,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(topK === undefined ? {} : { topK }),
    ...(topP === undefined ? {} : { topP }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
}

/**
 * Mastra `OpenAICompatibleConfig` (or a plain id when there is nothing extra).
 *
 * Passing `apiKey` / `url` here is how the operator key and local base URL
 * reach the SDK. Do not rely on the SDK reading a different env name.
 *
 * @param settings - Resolved transport
 */
export function toMastraModelConfig(settings: IcasLlmSettings): string | {
  id: `${string}/${string}`;
  apiKey?: string;
  url?: string;
} {
  const id = settings.model as `${string}/${string}`;
  if (settings.apiKey === undefined && settings.baseUrl === undefined) {
    return settings.model;
  }
  return {
    id,
    ...(settings.apiKey === undefined ? {} : { apiKey: settings.apiKey }),
    ...(settings.baseUrl === undefined ? {} : { url: settings.baseUrl }),
  };
}

/**
 * Sampling fields for Mastra `generate({ modelSettings })`.
 *
 * Omits undefined keys so the provider default applies. Empty object is
 * returned when nothing is set.
 */
export function toMastraModelSettings(settings: IcasLlmSettings): {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
} {
  return {
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.topK === undefined ? {} : { topK: settings.topK }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    ...(settings.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: settings.maxOutputTokens }),
  };
}

/**
 * First non-empty string among `values`.
 *
 * Empty string is treated as unset so `.env` placeholders do not win.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Parse an optional numeric env var.
 *
 * @param name - Env key (for the error message)
 * @param raw - Raw string
 * @param options.allowZero - When false, `0` is treated as unset (top-k/p)
 * @throws {Error} When the value is present but not a finite number
 */
function parseOptionalNumber(
  name: string,
  raw: string | undefined,
  options: { allowZero: boolean },
): number | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number`);
  }
  if (!options.allowZero && n === 0) {
    return undefined;
  }
  return n;
}
