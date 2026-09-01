/**
 * @file IcasLlmSettings — resolve per-flow LLM transport from env.
 *
 * Discover and `--assist` each have their own `ICAS_*_LLM_*` prefix so
 * operators can point them at different hosts. Env is model transport only;
 * {@link CandidateProposer} / RepairProposer stay the SDK seam.
 *
 * Empty `BASE_URL` means the provider's public host. Do not infer the
 * provider from `OPENAI_API_KEY` vs `ANTHROPIC_API_KEY` names on the
 * preferred path; those keys remain a fallback when the new vars are empty.
 */

/** Default `provider/model` when no explicit model id is set. Vision-capable. */
export const DEFAULT_ICAS_LLM_MODEL = "openai/gpt-4o";

/** Fallback Anthropic id when only `ANTHROPIC_API_KEY` is present. */
const FALLBACK_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4-6";

/**
 * Which CLI flow to resolve.
 *
 * `discovery` → `ICAS_DISCOVERY_LLM_*`. `assist` → `ICAS_ASSIST_LLM_*`.
 */
export type IcasLlmFlow = "discovery" | "assist";

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
 * Do not treat `OPENAI_API_KEY` as a special name in the caller; pass the
 * already-resolved settings.
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
 * Preferred: `ICAS_<FLOW>_LLM_*`. Fallback when those are empty: `ICAS_MODEL`,
 * `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (and Anthropic's default model when
 * only that key exists). Sampling has no legacy names.
 *
 * @param flow - Discovery or assist prefix
 * @param env - Process env; inject in tests
 */
export function resolveIcasLlmSettings(
  flow: IcasLlmFlow,
  env: NodeJS.ProcessEnv = process.env,
): IcasLlmSettings {
  const prefix = flow === "discovery" ? "ICAS_DISCOVERY_LLM" : "ICAS_ASSIST_LLM";
  const model = firstNonEmpty(
    env[`${prefix}_MODEL`],
    env.ICAS_MODEL,
    inferLegacyModel(env),
  ) ?? DEFAULT_ICAS_LLM_MODEL;
  const apiKey = firstNonEmpty(
    env[`${prefix}_API_KEY`],
    env.OPENAI_API_KEY,
    env.ANTHROPIC_API_KEY,
  );
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
 * Passing `apiKey` / `url` here keeps Mastra from looking up `OPENAI_API_KEY`
 * by name when the operator used `ICAS_*_LLM_API_KEY`.
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
 * Legacy model id when `ICAS_*_LLM_MODEL` and `ICAS_MODEL` are empty.
 *
 * Anthropic only when its key is set and OpenAI's is not, matching the old
 * resolver so existing shells keep working.
 */
function inferLegacyModel(env: NodeJS.ProcessEnv): string | undefined {
  const anthropic = env.ANTHROPIC_API_KEY;
  const openai = env.OPENAI_API_KEY;
  if (
    anthropic !== undefined &&
    anthropic.length > 0 &&
    (openai === undefined || openai.length === 0)
  ) {
    return FALLBACK_ANTHROPIC_MODEL;
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
