/**
 * @file Discovery model helpers — thin wrappers over {@link resolveIcasLlmSettings}.
 *
 * Reads `ICAS_DISCOVERY_LLM_*` only. These helpers never call the network;
 * {@link MastraCandidateProposer} does.
 */

import {
  DEFAULT_ICAS_LLM_MODEL,
  isIcasLlmReady,
  resolveIcasLlmSettings,
} from "./llm-settings.js";

/** @deprecated Use {@link DEFAULT_ICAS_LLM_MODEL}. Kept for existing imports. */
export const DEFAULT_DISCOVERY_MODEL = DEFAULT_ICAS_LLM_MODEL;

/**
 * Resolve the discovery `provider/model` id.
 *
 * @param env - Process env; inject in tests
 */
export function resolveDiscoveryModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveIcasLlmSettings("discovery", env).model;
}

/**
 * True when discovery can call a live model.
 *
 * Uses resolved `ICAS_DISCOVERY_LLM_*` settings.
 *
 * @param env - Process env
 */
export function hasDiscoveryApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return isIcasLlmReady(resolveIcasLlmSettings("discovery", env));
}

/**
 * Opt-in live smoke (`ICAS_DISCOVERY_SMOKE=1`). CI leaves this unset.
 */
export function discoverySmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ICAS_DISCOVERY_SMOKE === "1";
}
