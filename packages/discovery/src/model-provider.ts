/**
 * @file Discovery model router — Mastra `provider/model` strings from env.
 *
 * Default is `openai/gpt-4o` (image-capable for observation screenshots).
 * Override with `ICAS_MODEL`. Keys: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
 * These helpers never call the network; {@link MastraCandidateProposer} does.
 */

export const DEFAULT_DISCOVERY_MODEL = "openai/gpt-4o";

/**
 * Resolve the Mastra model id. Does not call the network.
 *
 * `ICAS_MODEL` always wins. Anthropic is chosen only when its key is set and
 * OpenAI's is not, so a dual-key environment still defaults to gpt-4o.
 *
 * @param env - Process env; inject in tests
 * @returns A `provider/model` string for Mastra's model router
 */
export function resolveDiscoveryModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.ICAS_MODEL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY.length > 0
    && (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.length === 0)) {
    return "anthropic/claude-sonnet-4-6";
  }
  return DEFAULT_DISCOVERY_MODEL;
}

/**
 * True when a provider key exists so a live generate could run.
 *
 * Used to skip optional smoke tests, not to pick a model.
 */
export function hasDiscoveryApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const openai = env.OPENAI_API_KEY;
  const anthropic = env.ANTHROPIC_API_KEY;
  return (
    (openai !== undefined && openai.length > 0)
    || (anthropic !== undefined && anthropic.length > 0)
  );
}

/**
 * Opt-in live smoke (`ICAS_DISCOVERY_SMOKE=1`). CI leaves this unset.
 */
export function discoverySmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ICAS_DISCOVERY_SMOKE === "1";
}
