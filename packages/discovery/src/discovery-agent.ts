/**
 * @file DiscoveryAgent — confidence-ordered DFS over a live surface.
 *
 * The model only ranks candidates. This class owns the graph: which sibling
 * to try next, when to backtrack, and how to restore the browser. Mastra is
 * injected as {@link CandidateProposer}; tests use a fake. Optional `log`
 * prints live progress; it does not replace the JSONL trace.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction, TargetDescriptor } from "@icas/capability";
import type { EvidenceWriter } from "@icas/evidence";
import type { HandoffController } from "@icas/handoff";
import type { PolicyGuard } from "@icas/policy";
import type { Observation, Surface, SurfaceActionResult } from "@icas/surface";

import {
  assignCandidateIds,
  sortCandidatesByRank,
  type CandidateAction,
  type CandidateProposal,
} from "./candidate-action.js";
import type { CandidateProposer } from "./candidate-proposer.js";
import type { DiscoveryRequest, DiscoveryResult, DiscoveryTraceEvent } from "./discovery-types.js";
import { DiscoveryTrace } from "./discovery-trace.js";
import {
  createSearchNode,
  resolveSearchBudget,
  stateIdFromObservation,
  type SearchBudget,
  type SearchNode,
} from "./search-state.js";

export interface DiscoveryAgentDependencies {
  /** Required so tests inject a fake and production injects Mastra. */
  proposer: CandidateProposer;
  /** Runtime allowlist before execute. Missing means allow (tests without a guard). */
  policy?: PolicyGuard;
  /** Same headed session HITL. Missing means {@link pauseForHuman} returns false. */
  handoff?: HandoffController;
  /** Append-only JSONL plus screenshot refs. Missing means in-memory events only. */
  evidence?: EvidenceWriter;
  /** Clock for the wall-clock budget; inject a fake in tests. */
  now?: () => number;
  /** Pass 3.1 markdown, injected into every proposer call. */
  promptPolicy?: string;
  /**
   * Live progress sink (CLI stderr). Missing means silent — tests omit this.
   * Does not replace the JSONL trace.
   */
  log?: (line: string) => void;
}

/**
 * Goal-driven search over a live surface. Catalog lookup is out of scope —
 * this agent always discovers; it never silently replays a stored capability.
 */
export class DiscoveryAgent {
  private readonly proposer: CandidateProposer;
  private readonly policy: PolicyGuard | undefined;
  private readonly handoff: HandoffController | undefined;
  private readonly evidence: EvidenceWriter | undefined;
  private readonly now: () => number;
  private readonly promptPolicy: string | undefined;
  private readonly onLog: ((line: string) => void) | undefined;

  /**
   * @param surface - Live observation/action seam (Playwright in production)
   * @param deps - Proposer required; policy, handoff, and evidence are optional
   */
  constructor(
    private readonly surface: Surface,
    deps: DiscoveryAgentDependencies,
  ) {
    this.proposer = deps.proposer;
    this.policy = deps.policy;
    this.handoff = deps.handoff;
    this.evidence = deps.evidence;
    this.now = deps.now ?? Date.now;
    this.promptPolicy = deps.promptPolicy;
    this.onLog = deps.log;
  }

  /**
   * Print one progress line when a sink is wired. No-op in unit tests.
   *
   * @param line - Single stderr line, already formatted
   */
  private log(line: string): void {
    this.onLog?.(line);
  }

  /**
   * Open the target URL and search until success, budget, or a failed action.
   *
   * Loop body is one DFS expansion: propose (once per node) → pick lowest-rank
   * untried sibling → policy → execute → observe. Dead-ends pop back to the
   * parent and restore the UI by replaying `pathActions`, not `page.goBack()`.
   *
   * @param request - Goal, surface identity, optional budgets, optional `runId`
   *   so the CLI can pre-create an evidence writer with a matching folder
   */
  async run(request: DiscoveryRequest): Promise<DiscoveryResult> {
    const runId = request.runId ?? randomUUID();
    // CLI pre-creates evidence with this id so JSONL and `createdFromRun` match.
    const budget = resolveSearchBudget({
      ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
      ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
      ...(request.maxCandidatesPerState === undefined
        ? {}
        : { maxCandidatesPerState: request.maxCandidatesPerState }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    });
    const trace = new DiscoveryTrace({
      runId,
      capabilityId: request.id,
      ...(this.evidence === undefined ? {} : { evidence: this.evidence }),
    });
    const startedAt = this.now();
    let steps = 0;
    const entryUrl = request.target.url;
    // Actions that led from entryUrl to `current`. Backtrack pops one and
    // replays the remainder so the headed session matches the in-memory parent.
    const pathActions: CapabilityAction[] = [];

    this.log(`runId=${runId}`);
    this.log(`goal=${request.goal}`);
    this.log(`open ${entryUrl}`);
    await this.surface.open(request.target.url);
    let current = createSearchNode({ observation: await this.surface.observe() });
    const seen = new Set<string>([current.stateId]);
    this.logObservation(current.observation);
    await trace.record(observationEvent(current.observation));

    while (true) {
      if (this.now() - startedAt >= budget.timeoutMs) {
        this.log("stop: timeout");
        return await finishStuck(trace, runId, "timeout");
      }
      if (steps >= budget.maxSteps) {
        this.log("stop: maxSteps");
        return await finishStuck(trace, runId, "maxSteps");
      }

      // First visit: ask the proposer. Later visits reuse ranked siblings
      // already stored on the node so we do not spend another LLM call.
      const filled = await this.fillCandidates(current, request, budget, trace);
      if (filled?.status === "success") {
        this.log("proposer declared success");
        await trace.finish("success");
        return { status: "success", runId, events: trace.events };
      }
      if (filled?.status === "stuck") {
        // Model refused to improvise. Treat as a dead-end and try a sibling
        // on the parent, same as exhausting candidates.
        this.log(`proposer stuck${filled.reason === undefined ? "" : `: ${filled.reason}`}`);
        const retreated = await this.backtrack(
          current,
          trace,
          filled.reason ?? "proposer stuck",
          entryUrl,
          pathActions,
        );
        if (retreated === undefined) {
          return await finishStuck(trace, runId, filled.reason ?? "proposer stuck");
        }
        current = retreated;
        continue;
      }

      if (current.depth >= budget.maxDepth) {
        this.log("stop: maxDepth");
        return await finishStuck(trace, runId, "maxDepth");
      }

      const candidate = nextUntried(current);
      if (candidate === undefined || candidate.id === undefined) {
        // Every ranked sibling on this screen has been tried (or denied).
        const retreated = await this.backtrack(
          current,
          trace,
          "exhausted",
          entryUrl,
          pathActions,
        );
        if (retreated === undefined) {
          return await finishStuck(trace, runId, "exhausted");
        }
        current = retreated;
        continue;
      }

      const action = candidate.action;
      this.log(
        `chosen rank=${String(candidate.rank)} ${summarizeAction(action)} — ${candidate.rationale}`,
      );
      await trace.record({
        type: "chosen_action",
        payload: {
          id: candidate.id,
          rank: candidate.rank,
          action,
          rationale: candidate.rationale,
          ...(candidate.expectation === undefined
            ? {}
            : { expectation: candidate.expectation }),
          ...(candidate.proposedInputParam === undefined
            ? {}
            : { proposedInputParam: candidate.proposedInputParam }),
          ...(candidate.possibleOutcomes === undefined
            ? {}
            : { possibleOutcomes: candidate.possibleOutcomes }),
        },
      });

      // Peek before execute so origin allowlists can deny a navigation
      // without clicking it. Missing policy = allow (tests without a guard).
      const destinationUrl = await this.peekDestination(action);
      const decision = this.policy?.check(
        action,
        destinationUrl === undefined ? {} : { destinationUrl },
      ) ?? { decision: "allow" as const };
      this.log(
        `policy ${decision.decision}${
          decision.decision === "allow" ? "" : `: ${decision.reason}`
        }`,
      );
      await trace.record({ type: "policy", payload: decision });
      if (decision.decision === "deny") {
        // Hard block: never execute. HITL records evidence, then we skip this
        // sibling and try the next rank on the same node.
        const paused = await this.pauseForHuman({
          runId,
          capabilityId: request.id,
          reason: "policy_block",
          message: decision.reason,
          trace,
        });
        current.triedCandidateIds.add(candidate.id);
        if (!paused) {
          await trace.finish("failure");
          return {
            status: "failed",
            runId,
            reason: decision.reason,
            events: trace.events,
          };
        }
        continue;
      }
      if (decision.decision === "require-human") {
        // Recurring approval: pause, then still execute the same action so
        // the compiler can emit a handoff step on the success path.
        const paused = await this.pauseForHuman({
          runId,
          capabilityId: request.id,
          reason: "approval_required",
          message: decision.reason,
          trace,
        });
        if (!paused) {
          current.triedCandidateIds.add(candidate.id);
          await trace.finish("failure");
          return {
            status: "failed",
            runId,
            reason: decision.reason,
            events: trace.events,
          };
        }
      }
      current.triedCandidateIds.add(candidate.id);

      const result = await this.executeAction(action);
      steps += 1;
      pathActions.push(action);
      await trace.record({ type: "action_result", payload: result });
      if (result.status !== "ok") {
        const reason = failedActionReason(result);
        this.log(`execute ${result.status}: ${reason}`);
        await trace.finish("failure");
        return {
          status: "failed",
          runId,
          reason,
          events: trace.events,
        };
      }
      this.log(`execute ok (${summarizeAction(action)})`);

      const nextObservation = await this.surface.observe();
      const nextId = stateIdFromObservation(nextObservation);
      if (seen.has(nextId)) {
        // Cycle: do not push a new node. Stay on `current` so the next loop
        // iteration tries the next ranked sibling. The failed action stays on
        // pathActions until we backtrack or succeed down another branch.
        await trace.record({ type: "dead_end", payload: { stateId: nextId, reason: "repeated_state" } });
        continue;
      }
      seen.add(nextId);
      current = createSearchNode({
        observation: nextObservation,
        parent: current,
      });
      this.logObservation(current.observation);
      await trace.record(observationEvent(current.observation));
    }
  }

  /**
   * Run one action. Playwright `locate` throws; turn that into a failed
   * result so the trace still gets `action_result` and `finish`.
   *
   * @param action - Policy-checked catalog action
   */
  private async executeAction(action: CapabilityAction): Promise<SurfaceActionResult> {
    try {
      return await this.surface.execute(action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "failed", details: { error: message } };
    }
  }

  /**
   * Stderr snapshot of the current page so a live run shows what the model sees.
   *
   * @param observation - Latest surface observe
   */
  private logObservation(observation: Observation): void {
    const url = observation.url ?? "(unknown url)";
    const preview = snapshotPreview(observation.accessibilitySnapshot);
    this.log(`observed id=${observation.id} url=${url} snapshotChars=${String(preview.chars)}`);
    this.log(`snapshot:\n${preview.text}`);
  }

  /**
   * Dump the validated proposal: status plus each ranked action.
   *
   * @param proposal - Catalog-shaped output after schema map
   */
  private logProposal(proposal: CandidateProposal): void {
    this.log(`LLM proposal:\n${JSON.stringify(proposal, null, 2)}`);
    for (const candidate of sortCandidatesByRank(proposal.candidates)) {
      this.log(
        `  rank ${String(candidate.rank)}: ${summarizeAction(candidate.action)} — ${candidate.rationale}`,
      );
    }
  }

  /**
   * Pop the DFS node and restore the surface by replaying the known prefix
   * from the entry URL. Do not call browser history-back (SPA/modal/POST).
   */
  private async backtrack(
    current: SearchNode,
    trace: DiscoveryTrace,
    reason: string,
    entryUrl: string,
    pathActions: CapabilityAction[],
  ): Promise<SearchNode | undefined> {
    await trace.record({ type: "dead_end", payload: { reason, stateId: current.stateId } });
    this.log(`dead-end ${reason} state=${current.stateId}`);
    if (current.parent === undefined) {
      return undefined;
    }
    // Drop the action that entered this node; replay what remains so the
    // browser is back on the parent screen before we try the next sibling.
    pathActions.pop();
    await this.restorePrefix(entryUrl, pathActions);
    await trace.record({
      type: "backtrack",
      payload: { from: current.stateId, to: current.parent.stateId, restore: "prefix-replay" },
    });
    return current.parent;
  }

  /**
   * Transfer the same headed session. Returns false when no handoff controller
   * is wired (headless tests) so the caller can fail closed.
   */
  private async pauseForHuman(args: {
    runId: string;
    capabilityId: string;
    reason: "policy_block" | "approval_required" | "discovery_stuck";
    message: string;
    trace: DiscoveryTrace;
  }): Promise<boolean> {
    if (this.handoff === undefined) {
      return false;
    }
    await this.handoff.request({
      runId: args.runId,
      capabilityId: args.capabilityId,
      reason: args.reason,
      message: args.message,
    });
    await args.trace.record({
      type: "intervention",
      payload: { reason: args.reason, message: args.message },
    });
    await this.surface.handoffToHuman();
    await this.handoff.waitForResume();
    await this.surface.resumeFromHuman();
    return true;
  }

  /**
   * Re-open the tenant URL and re-execute the successful prefix. Cheaper than
   * trusting history when a dead-end was a POST or a modal.
   */
  private async restorePrefix(
    entryUrl: string,
    pathActions: readonly CapabilityAction[],
  ): Promise<void> {
    await this.surface.open(entryUrl);
    for (const action of pathActions) {
      await this.surface.execute(action);
    }
  }

  /**
   * Ask the proposer once per node. `success` / `stuck` end the run.
   * Rank 1 is stored first so {@link nextUntried} walks confidence order.
   */
  private async fillCandidates(
    node: SearchNode,
    request: DiscoveryRequest,
    budget: SearchBudget,
    trace: DiscoveryTrace,
  ): Promise<{ status: "success" } | { status: "stuck"; reason?: string } | undefined> {
    if (node.candidates.length > 0) {
      return undefined;
    }
    this.log(`proposing for observation ${node.observation.id}`);
    const proposal = await this.proposer.propose({
      goal: request.goal,
      observation: node.observation,
      // Chosen actions only — not the full JSONL — so the model sees the
      // path taken, not failed siblings already dropped by DFS.
      history: trace.events
        .filter((event) => event.type === "chosen_action")
        .map((event) => JSON.stringify(event.payload)),
      ...(this.promptPolicy === undefined ? {} : { promptPolicy: this.promptPolicy }),
    });
    this.logProposal(proposal);
    await trace.record({
      type: "candidates",
      payload: {
        status: proposal.status,
        count: proposal.candidates.length,
        ...(proposal.rationale === undefined ? {} : { rationale: proposal.rationale }),
        candidates: proposal.candidates,
      },
    });
    if (proposal.status === "success") {
      // Compiler reads `payload.result`. Empty object is only for traces that
      // omitted the field before this contract existed.
      await trace.record({
        type: "success",
        payload: proposal.result === undefined ? {} : { result: proposal.result },
      });
      return { status: "success" };
    }
    if (proposal.status === "stuck") {
      return proposal.rationale === undefined
        ? { status: "stuck" }
        : { status: "stuck", reason: proposal.rationale };
    }
    node.candidates = sortCandidatesByRank(
      assignCandidateIds(proposal.candidates),
    ).slice(0, budget.maxCandidatesPerState);
    return undefined;
  }

  /**
   * Best-effort href for policy origin checks. Navigate/fill have no target
   * peek; failures must not abort discovery.
   */
  private async peekDestination(
    action: CapabilityAction,
  ): Promise<string | undefined> {
    if (!("target" in action)) {
      return undefined;
    }
    try {
      return await this.surface.peekDestination(action.target);
    } catch {
      return undefined;
    }
  }
}

/** Lowest rank among candidates that have not been expanded or denied. */
function nextUntried(node: SearchNode): CandidateAction | undefined {
  return node.candidates.find((candidate) => {
    return candidate.id !== undefined && !node.triedCandidateIds.has(candidate.id);
  });
}

/** Compact observation for the trace: id, url, imagePath only (no a11y dump). */
function observationEvent(observation: Observation): DiscoveryTraceEvent {
  return {
    type: "observation",
    payload: {
      id: observation.id,
      url: observation.url,
      imagePath: observation.imagePath,
    },
  };
}

/**
 * End the run as stuck (budget, exhausted, or proposer refused).
 * Distinct from `failed`, which is a denied or broken execute.
 */
async function finishStuck(
  trace: DiscoveryTrace,
  runId: string,
  reason: string,
): Promise<DiscoveryResult> {
  await trace.finish("stuck");
  return { status: "stuck", runId, reason, events: trace.events };
}

/**
 * Prefer the thrown surface message over a generic "action failed".
 *
 * @param result - Non-ok execute result
 */
function failedActionReason(result: SurfaceActionResult): string {
  if (result.details !== null && typeof result.details === "object" && "error" in result.details) {
    const error = (result.details as { error?: unknown }).error;
    if (typeof error === "string" && error.length > 0) {
      return error;
    }
  }
  return "action failed";
}

/** Cap ARIA dump on stderr so one huge page does not flood the terminal. */
const MAX_LOG_SNAPSHOT_CHARS = 1_500;

/**
 * Compact snapshot for live logs. Full text still goes to the proposer prompt.
 *
 * @param snapshot - Playwright aria snapshot, if captured
 */
function snapshotPreview(snapshot: unknown): { chars: number; text: string } {
  const text =
    typeof snapshot === "string"
      ? snapshot
      : snapshot === undefined || snapshot === null
        ? ""
        : JSON.stringify(snapshot);
  if (text.length === 0) {
    return { chars: 0, text: "(none)" };
  }
  if (text.length <= MAX_LOG_SNAPSHOT_CHARS) {
    return { chars: text.length, text };
  }
  return {
    chars: text.length,
    text: `${text.slice(0, MAX_LOG_SNAPSHOT_CHARS)}\n…(truncated ${String(text.length - MAX_LOG_SNAPSHOT_CHARS)} chars)`,
  };
}

/**
 * One-line action so operators see the locator without opening JSONL.
 *
 * @param action - Catalog action about to execute
 */
function summarizeAction(action: CapabilityAction): string {
  if (action.type === "navigate") {
    return `navigate ${action.path}`;
  }
  if (action.type === "handoff") {
    return `handoff ${action.reason}`;
  }
  if (action.type === "fill" || action.type === "select") {
    return `${action.type} ${summarizeTarget(action.target)} value=${JSON.stringify(action.value)}`;
  }
  return `${action.type} ${summarizeTarget(action.target)}`;
}

/**
 * First locator strategy as `type key=value` pairs.
 *
 * @param target - Ranked strategies on the action
 */
function summarizeTarget(target: TargetDescriptor): string {
  const strategy = target.strategies[0];
  if (strategy === undefined) {
    return "(empty target)";
  }
  const parts: string[] = [];
  if ("role" in strategy && typeof strategy.role === "string") {
    parts.push(`role=${strategy.role}`);
  }
  if ("text" in strategy && typeof strategy.text === "string") {
    parts.push(`text=${strategy.text}`);
  }
  if ("label" in strategy && typeof strategy.label === "string") {
    parts.push(`label=${strategy.label}`);
  }
  if ("selector" in strategy && typeof strategy.selector === "string") {
    parts.push(`selector=${strategy.selector}`);
  }
  if ("xpath" in strategy && typeof strategy.xpath === "string") {
    parts.push(`xpath=${strategy.xpath}`);
  }
  if (strategy.type === "coordinates") {
    parts.push(`xy=${String(strategy.x)},${String(strategy.y)}`);
  }
  return parts.length === 0 ? strategy.type : `${strategy.type} ${parts.join(" ")}`;
}
