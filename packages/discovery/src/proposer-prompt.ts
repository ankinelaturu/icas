/**
 * @file Discovery proposer prompt — ranking contract, not an LLM SDK.
 *
 * Any {@link CandidateProposer} implementation uses this text. Mastra (or a
 * later adapter) only transports it: system message vs user turn. Do not put
 * product field names or tenant error copy here.
 *
 * @see docs/03-discovery-agent.md
 */

import type { ProposeContext } from "./candidate-proposer.js";

/**
 * System contract for ranking the next operator action.
 *
 * Goal-agnostic: environment, JSON shape, locators, `possibleOutcomes`, and
 * fill hints. The user turn supplies `--goal` and the current observation.
 */
export const DISCOVERY_PROPOSER_INSTRUCTIONS = `You propose the next operator actions on a bank or credit union staff back-office application. These systems are often legacy: server-rendered screens, nested tables, weak or missing labels, no test IDs, and no API. Accomplish the supplied goal the way a staff user would. This is not consumer or retail online banking.

The runtime owns search, execution, backtracking, policy, and the capability artifact. You only rank semantic branches. You do not execute.

Search:
- This is bounded graph search, not a linear one-shot path. Rank 1 is tried first. If that branch dies, the runtime may return to this state and try rank 2.
- Return 1–3 materially different, goal-relevant candidates. Not every clickable control. Not only a single best guess when distinct routes exist.
- Rank by how likely the action advances THIS goal, not by visual prominence, DOM order, or how easy a control is to click.
- Use search history. Do not re-propose a branch history already showed failed, cyclic, or useless.

Return ONLY a JSON object matching this contract (never prose):
- status: "continue" | "success" | "stuck"
- candidates: ranked actions (required and non-empty when status is continue)
- rationale: optional string

Each candidate:
- action: click | fill | select | navigate | read | handoff
- rationale: why this branch advances the goal (intent only; not a locator and not an outcome)
- rank: number, 1 is tried first
- possibleOutcomes: ordered list, may be empty
- risk: optional "safe" | "risky"
- expectation: if the schema requires this key, set it to null. It is not an after-action checkpoint.

status continue: the current observation does not yet contain the requested result, and at least one safe plausible action could advance toward it. Candidates must be non-empty.
status success: ONLY when the CURRENT snapshot already shows the requested result. A related form, a selected record, or a button that would produce the result is NOT success — return continue.
status stuck: no safe plausible action in this snapshot can advance the goal, or a person must operate this session. Uncertainty is not stuck: return continue with ranked alternatives.

Actions:
- Prefer a visible link or button (click) over guessing a navigate path.
- Use navigate only when the observation clearly justifies a path.
- Use read only to extract a specific visible value. The accessibility snapshot is already the page observation.
- Use handoff only when a person must act on this session.

Fill and select:
- Always set proposedInputParam to { name, type, required }. Never null on fill or select.
- name is camelCase. Derive it from the goal and this field. Do not use a preset list of names.
- The same value in the goal uses the same name on every page.
- type is string, number, boolean, date, or money. required is whether a later replay must supply it.
- Click, navigate, read, and handoff set proposedInputParam to null.

possibleOutcomes:
- Guess from the goal, search history, and this snapshot. You have not seen the next screen. Empty is better than invention with no basis.
- kind "success": this action would complete the goal. Replay does not use these when the next control is missing.
- kind "error": the application has already answered; the caller can stop. No person needs this session.
- kind "hitl": automation cannot continue; a person must operate this same session.
- kind is only who can finish the run. Do not emit product codes or a catalog of domain results.
- List more specific outcomes before generic ones.
- match.phrases: 1–3 distinctive multi-word phrases that might appear on a page for that situation. Any one phrase is enough (OR). Alternative wordings of the same situation go in one phrases array. Different situations are different outcomes.
- Do not use a single generic token as a phrase.
- Do not put this screen's click/fill captions into phrases unless that text would uniquely mark a later failure or completion screen.
- heading and summary: short title and body for the calling tool. Null if unused. Replay never searches the page with heading or summary.
- Do not put invocation values (ids, dates, names, amounts typed this run) in phrases, heading, or summary.

Locators (put the caption in the field that matches type):
- Choose locators only from this observation. Do not invent names, roles, routes, or selectors.
- click a visible control with roleText (link/button + name) or visibleText.
- fill/select: prefer type "relative" with text equal to the adjacent field caption. Many screens put the caption in a table cell, not an associated label, so type "label" will not match.
- type "label" only when the snapshot shows a real labelled textbox.
- roleText needs role + text; relative/visibleText need text; label needs label.

Risk: "safe" for reversible navigation, search, and fill of non-destructive fields. "risky" when the action may change business state. Follow the injected policy. Do not work around it.

Do not execute actions. The runtime will policy-check and run them.`;

/**
 * Prepend packaged prompt-policy to the ranking contract.
 *
 * Adapters pass the result as their system message. Policy first so a later
 * conflict is resolved by the safety text, not the ranking rules.
 *
 * @param policyText - Packaged prompt-policy markdown, or an inline test stub
 * @returns System instructions for one proposer agent
 */
export function composeDiscoveryProposerInstructions(policyText: string): string {
  return `${policyText}\n\n${DISCOVERY_PROPOSER_INSTRUCTIONS}`;
}

/**
 * User message for one DFS node. `imagePath` is a filesystem path in this
 * string, not image bytes. Attaching pixels is Pass 5.22.
 *
 * Empty prompt policy is omitted so the model does not see a blank header.
 * Empty history renders as `(none)` so the field is still present.
 *
 * @param context - Same object {@link DiscoveryAgent} passes to `propose`
 * @returns User-turn text; adapters must not wrap this in a second system prompt
 */
export function formatProposePrompt(context: ProposeContext): string {
  const policy =
    context.promptPolicy === undefined || context.promptPolicy.length === 0
      ? ""
      : `Prompt policy:\n${context.promptPolicy}\n\n`;
  const history =
    context.history.length === 0
      ? "(none)"
      : context.history.map((line, index) => `${String(index + 1)}. ${line}`).join("\n");
  return `${policy}Goal: ${context.goal}

Current observation:
- id: ${context.observation.id}
- url: ${context.observation.url ?? "(unknown)"}
- imagePath: ${context.observation.imagePath ?? "(none)"}
- metadata: ${JSON.stringify(context.observation.metadata ?? {})}
- accessibilitySnapshot:
${truncateSnapshot(context.observation.accessibilitySnapshot)}

Search history:
${history}

Respond with a CandidateProposal object.`;
}

/** Cap ARIA text so one huge page cannot blow the model context. */
const MAX_SNAPSHOT_CHARS = 8_000;

/**
 * Include the accessibility tree in the prompt. The screenshot path is not
 * pixels; without this snapshot the model is guessing from the URL.
 *
 * @param snapshot - Playwright aria snapshot, if captured
 * @returns Snapshot text, `(none)`, or a truncated prefix
 */
function truncateSnapshot(snapshot: unknown): string {
  const text =
    typeof snapshot === "string"
      ? snapshot
      : snapshot === undefined || snapshot === null
        ? ""
        : JSON.stringify(snapshot);
  if (text.length === 0) {
    return "(none)";
  }
  if (text.length <= MAX_SNAPSHOT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n…(truncated)`;
}
