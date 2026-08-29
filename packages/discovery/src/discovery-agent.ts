/**
 * @file DiscoveryAgent — always discovers; never silently replays a catalog artifact.
 *
 * Loop (this pass): observe → propose → policy → execute → record → stop on
 * budget. Ranked DFS, backtrack, HITL, and the compiler are later passes.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction } from "@icas/capability";
import type { PolicyGuard } from "@icas/policy";
import type { Surface } from "@icas/surface";

import type { CandidateProposer } from "./candidate-proposer.js";
import type { DiscoveryRequest, DiscoveryResult, DiscoveryTraceEvent } from "./discovery-types.js";
import { resolveSearchBudget } from "./search-state.js";

export interface DiscoveryAgentDependencies {
  /** Required so tests inject a fake and production injects Mastra. */
  proposer: CandidateProposer;
  policy?: PolicyGuard;
  now?: () => number;
  /** Pass 3.1 markdown, injected into every proposer call. */
  promptPolicy?: string;
}

/**
 * Goal-driven search over a live surface. Catalog lookup is out of scope.
 */
export class DiscoveryAgent {
  private readonly proposer: CandidateProposer;
  private readonly policy: PolicyGuard | undefined;
  private readonly now: () => number;
  private readonly promptPolicy: string | undefined;

  constructor(
    private readonly surface: Surface,
    deps: DiscoveryAgentDependencies,
  ) {
    this.proposer = deps.proposer;
    this.policy = deps.policy;
    this.now = deps.now ?? Date.now;
    this.promptPolicy = deps.promptPolicy;
  }

  /**
   * Open the target URL and search until success, budget, or a failed action.
   */
  async run(request: DiscoveryRequest): Promise<DiscoveryResult> {
    const runId = randomUUID();
    const budget = resolveSearchBudget({
      ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
      ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
      ...(request.maxCandidatesPerState === undefined
        ? {}
        : { maxCandidatesPerState: request.maxCandidatesPerState }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    });
    const events: DiscoveryTraceEvent[] = [];
    const startedAt = this.now();
    let steps = 0;

    await this.surface.open(request.target.url);

    while (true) {
      if (this.now() - startedAt >= budget.timeoutMs) {
        return stuck(runId, events, "timeout");
      }
      if (steps >= budget.maxSteps) {
        return stuck(runId, events, "maxSteps");
      }

      const observation = await this.surface.observe();
      events.push({ type: "observation", payload: { id: observation.id, url: observation.url } });

      const proposal = await this.proposer.propose({
        goal: request.goal,
        observation,
        history: events
          .filter((event) => event.type === "chosen_action")
          .map((event) => JSON.stringify(event.payload)),
        ...(this.promptPolicy === undefined ? {} : { promptPolicy: this.promptPolicy }),
      });
      events.push({
        type: "candidates",
        payload: { status: proposal.status, count: proposal.candidates.length },
      });

      if (proposal.status === "success") {
        events.push({ type: "success" });
        return { status: "success", runId, events };
      }
      if (proposal.status === "stuck") {
        return stuck(runId, events, proposal.rationale ?? "proposer stuck");
      }

      const candidate = proposal.candidates[0];
      if (candidate === undefined) {
        return stuck(runId, events, "no candidate");
      }

      const action = candidate.action;
      events.push({ type: "chosen_action", payload: { rank: candidate.rank, action } });

      const destinationUrl = await this.peekDestination(action);
      const decision = this.policy?.check(
        action,
        destinationUrl === undefined ? {} : { destinationUrl },
      ) ?? { decision: "allow" as const };
      events.push({ type: "policy", payload: decision });
      if (decision.decision !== "allow") {
        return {
          status: "failed",
          runId,
          reason: decision.reason,
          events,
        };
      }

      const result = await this.surface.execute(action);
      steps += 1;
      events.push({ type: "action_result", payload: result });
      if (result.status !== "ok") {
        return {
          status: "failed",
          runId,
          reason: "action failed",
          events,
        };
      }
    }
  }

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

function stuck(
  runId: string,
  events: DiscoveryTraceEvent[],
  reason: string,
): DiscoveryResult {
  return { status: "stuck", runId, reason, events };
}
