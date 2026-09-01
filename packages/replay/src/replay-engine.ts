/**
 * @file ReplayEngine — deterministic execution of an already-resolved capability.
 *
 * Callers resolve tenant overrides first. This class never branches on tenant
 * identity. Strict replay contains no LLM; `--assist` may invoke one bounded
 * {@link RepairProposer} repair, then must rejoin the original path.
 */

import { randomUUID } from "node:crypto";

import type { CapabilityAction, CapabilityArtifact, CapabilityStep } from "@icas/capability";
import {
  ASSISTED_FALLBACK_EVENT,
  DETERMINISTIC_ACTION_EVENT,
  type EvidenceActor,
  type EvidenceWriter,
} from "@icas/evidence";
import type { HandoffController } from "@icas/handoff";
import type { PolicyGuard } from "@icas/policy";
import type { Observation, Surface } from "@icas/surface";

import {
  ReplayFailureCode,
  type ExecutionResult,
} from "./execution-result.js";
import { extractOutputs, isExecutionResult } from "./extract-outputs.js";
import { GENERIC_CHROME_OUTCOMES } from "./generic-chrome.js";
import { hydrateAction, hydrateAssertion } from "./hydrate.js";
import {
  matchPossibleOutcomes,
  outcomeSlug,
  type MatchedPossibleOutcome,
} from "./match-possible-outcomes.js";
import { INTERSTITIAL_CONTINUE, INTERSTITIAL_TEXTS } from "./recoverable.js";
import type { RepairProposer } from "./repair-proposer.js";
import type { ReplayOptions } from "./replay-options.js";
import { hasSurfaceCode } from "./surface-code.js";

/**
 * Optional collaborators. Policy is required for a safe production run.
 *
 * Missing policy fails open (allow) so unit tests can omit a guard. Missing
 * evidence skips persistence, not execution. Missing handoff turns
 * `require-human` into {@link ReplayFailureCode.policyBlocked}. Missing repair
 * disables `--assist` even when the flag is set.
 */
export interface ReplayEngineDependencies {
  /** Deny off-origin navigations and risky actions before {@link Surface.execute}. */
  policy?: PolicyGuard;
  /**
   * Full run log (checkpoints, recoveries, HITL, assist, terminal result).
   * Redaction lives in the writer.
   */
  evidence?: EvidenceWriter;
  /** Same-session HITL. Not a co-browsing console. */
  handoff?: HandoffController;
  /** One bounded LLM repair when `options.assist` is true. */
  repair?: RepairProposer;
}

/**
 * Execute a supplied effective capability. Callers resolve tenant overrides
 * first via CapabilityResolver. This engine never branches on tenant identity,
 * vendor, or product.
 *
 * Playwright is only the {@link Surface} implementation. Artifacts stay
 * semantic (click/fill/assert), not locator scripts.
 */
export class ReplayEngine {
  private readonly policy: PolicyGuard | undefined;
  private readonly evidence: EvidenceWriter | undefined;
  private readonly handoff: HandoffController | undefined;
  private readonly repair: RepairProposer | undefined;
  /** Recoverable interstitial retries, not semantic-mismatch retries. */
  private maxAttempts = 2;
  /** Cap on repair actions in one `--assist` attempt. */
  private assistBudget = 3;
  private assistEnabled = false;
  /** One assist per run: freeze, repair, rejoin — not rediscovery. */
  private assistUsed = false;
  private currentCapability: CapabilityArtifact | undefined;
  private startedAt = "";
  /** Capability steps that fully passed postconditions. */
  private completedSteps = 0;

  constructor(
    private readonly surface: Surface,
    deps: ReplayEngineDependencies = {},
  ) {
    this.policy = deps.policy;
    this.evidence = deps.evidence;
    this.handoff = deps.handoff;
    this.repair = deps.repair;
  }

  /**
   * Iterate capability steps and return a structured result.
   *
   * Preconditions → policy-gated execute → next-locator / possibleOutcomes
   * (or last-step success), then output extraction. LLM repair runs only when
   * `options.assist` is true and a {@link RepairProposer} is injected.
   *
   * @param capability - Effective artifact from {@link CapabilityResolver}, or missing
   * @param inputs - Typed invocation parameters used to hydrate ValueRefs
   * @param options - Replay flags: `assist`, budgets, optional stable `runId`
   */
  async run(
    capability: CapabilityArtifact | undefined,
    inputs: Record<string, unknown>,
    options: ReplayOptions = {},
  ): Promise<ExecutionResult> {
    const runId = options.runId ?? randomUUID();
    this.maxAttempts = options.maxRetries ?? 2;
    this.assistEnabled = options.assist === true;
    this.assistBudget = options.assistBudget ?? 3;
    this.assistUsed = false;
    this.completedSteps = 0;
    this.startedAt = new Date().toISOString();
    const result = await this.runLoop(capability, inputs, runId);
    // Every terminal status gets JSONL + summary. Rich signals only on stops.
    await this.finalizeEvidence(result);
    return result;
  }

  /**
   * Walk steps until a structured stop or overall success.
   *
   * @returns A failure as soon as a checkpoint cannot continue; otherwise
   *   {@link finishRun}
   */
  private async runLoop(
    capability: CapabilityArtifact | undefined,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<ExecutionResult> {
    if (capability === undefined) {
      // Missing artifact is a caller error (resolve failed or id unknown),
      // not a surface crash. Fail closed with a structured code.
      return {
        status: "failure",
        capabilityId: "unknown",
        code: ReplayFailureCode.missingCapability,
        runId,
      };
    }
    this.currentCapability = capability;
    await this.record(runId, "run_start", { capabilityId: capability.id });
    for (let index = 0; index < capability.steps.length; index++) {
      const step = capability.steps[index];
      if (step === undefined) {
        // noUncheckedIndexedAccess: sparse holes are skipped, not treated as failure.
        continue;
      }
      // Peek the next step so a successful `--assist` can verify its
      // preconditions before rejoining this loop.
      const nextStep = capability.steps[index + 1];
      const preFailure = await this.evaluatePreconditions(step, inputs, runId, capability.id);
      if (preFailure !== undefined) {
        return preFailure;
      }
      const blocked = await this.executeStep(step, nextStep, inputs, runId, capability.id);
      if (blocked !== undefined) {
        return blocked;
      }
      this.completedSteps += 1;
    }
    return await this.finishRun(capability, inputs, runId);
  }

  /**
   * After every step succeeds, check overall `success` assertions and extract outputs.
   *
   * Per-step postconditions are not enough: a click can land on a valid screen
   * that still is not the declared payoff result.
   */
  private async finishRun(
    capability: CapabilityArtifact,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<ExecutionResult> {
    for (const assertion of capability.success) {
      const expected = hydrateAssertion(assertion, inputs);
      const ok = await this.surface.assert(expected);
      if (!ok) {
        await this.record(runId, "success_check", {
          status: "failed",
          expected,
        });
        const last = capability.steps[capability.steps.length - 1];
        if (last !== undefined) {
          const classified = await this.classifyExceptionalState(
            last,
            undefined,
            inputs,
            runId,
            capability.id,
          );
          if (classified !== undefined) {
            return classified;
          }
        }
        return {
          status: "failure",
          capabilityId: capability.id,
          code: ReplayFailureCode.unexpectedState,
          expected,
          observed: false,
          runId,
        };
      }
      await this.record(runId, "success_check", { status: "ok", expected });
    }
    const extracted = await extractOutputs({
      surface: this.surface,
      capability,
      runId,
      ...(this.policy === undefined ? {} : { policy: this.policy }),
    });
    if (isExecutionResult(extracted)) {
      // Extraction/type failures stay structured so CLI/MCP do not throw.
      // extractOutputs only returns `failure` on this branch; success has no `code`.
      await this.record(runId, "outputs", {
        status: "failed",
        ...(extracted.status === "failure" ? { code: extracted.code } : {}),
      });
      return extracted;
    }
    await this.record(runId, "outputs", {
      status: "ok",
      outputs: extracted.outputs,
    });
    return {
      status: "success",
      capabilityId: capability.id,
      outputs: extracted.outputs,
      runId,
    };
  }

  /**
   * Evaluate one step's checkpoints. Wired in a later pass.
   */
  async verifyStep(_step: CapabilityStep): Promise<void> {
    throw new Error("ReplayEngine.verifyStep is a scaffold.");
  }

  /**
   * Assert every precondition, with a bounded interstitial retry.
   *
   * @returns `undefined` when the step may execute; otherwise a structured failure
   */
  private async evaluatePreconditions(
    step: CapabilityStep,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let failed: ReturnType<typeof hydrateAssertion> | undefined;
      for (const assertion of step.preconditions) {
        const expected = hydrateAssertion(assertion, inputs);
        if (!(await this.surface.assert(expected))) {
          failed = expected;
          break;
        }
      }
      if (failed === undefined) {
        await this.record(runId, "precondition", {
          stepId: step.id,
          status: "ok",
        });
        return undefined;
      }
      // Retry only after a known interstitial dismiss. Semantic mismatches
      // (wrong screen) must not become indefinite waits.
      if (attempt < this.maxAttempts && (await this.recoverInterstitial(runId, attempt))) {
        continue;
      }
      await this.record(runId, "precondition", {
        stepId: step.id,
        status: "failed",
        expected: failed,
      });
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.preconditionFailed,
        stepId: step.id,
        expected: failed,
        observed: false,
        runId,
      };
    }
    return undefined;
  }

  /**
   * Policy-check, execute, then postcondition. Assist is considered on classified fails.
   *
   * @returns `undefined` when the step completed; otherwise a stop result
   */
  private async executeStep(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    const action = hydrateAction(step.action, inputs);
    const destinationUrl = await this.peekDestination(action);
    // Policy sees the destination before click so origin allowlists can deny
    // without navigating. Missing policy = allow (tests without a guard).
    const decision = this.policy?.check(action, destinationUrl === undefined
      ? {}
      : { destinationUrl }) ?? { decision: "allow" as const };
    await this.record(runId, "policy", { stepId: step.id, decision });
    if (decision.decision === "require-human") {
      // Same headed session: pause automation, wait, resume. No co-browse.
      const paused = await this.pauseForHuman({
        runId,
        capabilityId,
        stepId: step.id,
        reason: "approval_required",
        message: decision.reason,
      });
      if (!paused) {
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.policyBlocked,
          stepId: step.id,
          expected: action,
          observed: decision,
          runId,
        };
      }
    } else if (decision.decision !== "allow") {
      // Hard deny: never execute. Distinct from HITL pause.
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.policyBlocked,
        stepId: step.id,
        expected: action,
        observed: decision,
        runId,
      };
    }
    try {
      const result = await this.surface.execute(action);
      if (result.status !== "ok") {
        await this.record(runId, DETERMINISTIC_ACTION_EVENT, {
          stepId: step.id,
          status: "failed",
          action,
          result,
        });
        // Surface returned a structured fail; try one bounded assist, else stop.
        return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.unexpectedState,
          stepId: step.id,
          expected: action,
          observed: result,
          runId,
        });
      }
      await this.record(runId, DETERMINISTIC_ACTION_EVENT, {
        stepId: step.id,
        status: "ok",
        action,
      });
    } catch (error) {
      if (hasSurfaceCode(error, ReplayFailureCode.targetNotFound)) {
        await this.record(runId, DETERMINISTIC_ACTION_EVENT, {
          stepId: step.id,
          status: "failed",
          action,
          code: ReplayFailureCode.targetNotFound,
        });
        // Duck-typed so replay does not import `@icas/browser`.
        return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.targetNotFound,
          stepId: step.id,
          expected: action,
          observed: error instanceof Error ? error.message : error,
          runId,
        });
      }
      throw error;
    }
    const after = await this.afterSuccessfulExecute(
      step,
      nextStep,
      inputs,
      runId,
      capabilityId,
    );
    if (after !== undefined && after.status === "failure") {
      return await this.maybeAssist(step, nextStep, inputs, runId, capabilityId, after);
    }
    return after;
  }

  /**
   * After this step's action ran, decide happy-path vs exceptional state.
   *
   * This step's own target miss is handled before this method. When a next
   * step exists, its locator is the happy-path gate: found → postconditions;
   * missing → this step's `possibleOutcomes`. Last step uses postconditions
   * then overall success (caller).
   *
   * @returns `undefined` to continue the step loop; otherwise a structured stop
   */
  private async afterSuccessfulExecute(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    if (nextStep !== undefined) {
      if (await this.nextActionTargetPresent(nextStep)) {
        return await this.evaluatePostconditions(step, inputs, runId, capabilityId);
      }
      const classified = await this.classifyExceptionalState(
        step,
        nextStep,
        inputs,
        runId,
        capabilityId,
      );
      if (classified !== undefined) {
        return classified;
      }
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.unexpectedState,
        stepId: step.id,
        expected: nextStep.action,
        observed: "next action target missing; no possibleOutcomes or generic chrome matched",
        runId,
      };
    }
    const post = await this.evaluatePostconditions(step, inputs, runId, capabilityId);
    if (post === undefined) {
      return undefined;
    }
    const classified = await this.classifyExceptionalState(
      step,
      undefined,
      inputs,
      runId,
      capabilityId,
    );
    return classified ?? post;
  }

  /**
   * HTTP status, then this step's possibleOutcomes, then runtime generic chrome.
   *
   * Call only after the next locator missed (or last-step success/post missed).
   * Missing `httpStatus` is normal and continues to phrases. 403/404 fail
   * before phrases. 5xx retries a known interstitial then fails if still stuck.
   *
   * @returns A structured stop, or `undefined` when nothing matched
   */
  private async classifyExceptionalState(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    const observation = await this.surface.observe();
    const httpStatus = observation.httpStatus;
    if (httpStatus === 403 || httpStatus === 404) {
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.unexpectedState,
        stepId: step.id,
        expected: nextStep?.action ?? "document ok",
        observed: { httpStatus },
        runId,
      };
    }
    if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) {
      await this.recoverInterstitial(runId, 1);
      if (nextStep !== undefined && (await this.nextActionTargetPresent(nextStep))) {
        return await this.evaluatePostconditions(step, inputs, runId, capabilityId);
      }
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.unexpectedState,
        stepId: step.id,
        expected: nextStep?.action ?? "document ok",
        observed: { httpStatus },
        runId,
      };
    }
    const fromStep = await this.resultFromPossibleOutcomes(
      step,
      nextStep,
      runId,
      capabilityId,
    );
    if (fromStep !== undefined) {
      return fromStep;
    }
    const genericHit = await matchPossibleOutcomes(this.surface, GENERIC_CHROME_OUTCOMES);
    if (genericHit === undefined) {
      return undefined;
    }
    return await this.applyMatchedOutcome(
      genericHit,
      step,
      nextStep,
      runId,
      capabilityId,
    );
  }

  /**
   * Whether the next step's action target is on the page.
   *
   * Actions without a target (navigate / handoff) cannot be probed; treat them
   * as present so we do not classify the previous step's outcomes.
   */
  private async nextActionTargetPresent(step: CapabilityStep): Promise<boolean> {
    const action = step.action;
    if (!("target" in action)) {
      return true;
    }
    try {
      await this.surface.locate(action.target);
      return true;
    } catch (error) {
      if (hasSurfaceCode(error, ReplayFailureCode.targetNotFound)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Map a matched catalog outcome to `business_outcome` or same-session HITL.
   *
   * @returns A stop result, or `undefined` after a successful HITL resume
   */
  private async resultFromPossibleOutcomes(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    const hit = await matchPossibleOutcomes(this.surface, step.possibleOutcomes);
    if (hit === undefined) {
      return undefined;
    }
    return await this.applyMatchedOutcome(hit, step, nextStep, runId, capabilityId);
  }

  /**
   * Map a matched catalog or runtime outcome to `business_outcome` or HITL.
   */
  private async applyMatchedOutcome(
    hit: MatchedPossibleOutcome,
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    if (hit.outcome.kind === "error") {
      return this.businessOutcomeResult(capabilityId, runId, hit);
    }
    const message = hitlMessage(hit);
    const paused = await this.pauseForHuman({
      runId,
      capabilityId,
      stepId: step.id,
      reason: "unexpected_state",
      message,
    });
    if (!paused) {
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.unexpectedState,
        stepId: step.id,
        expected: hit.outcome,
        observed: message,
        runId,
      };
    }
    if (nextStep !== undefined && !(await this.nextActionTargetPresent(nextStep))) {
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.unexpectedState,
        stepId: step.id,
        expected: nextStep.action,
        observed: "next action target still missing after HITL",
        runId,
      };
    }
    return undefined;
  }

  /**
   * Structured domain stop from a matched `error` outcome.
   */
  private businessOutcomeResult(
    capabilityId: string,
    runId: string,
    hit: MatchedPossibleOutcome,
  ): ExecutionResult {
    return {
      status: "business_outcome",
      capabilityId,
      outcome: outcomeSlug(hit.outcome.heading, hit.phrase),
      details: {
        heading: hit.outcome.heading,
        summary: hit.outcome.summary,
        match: hit.outcome.match,
        phrase: hit.phrase,
      },
      runId,
    };
  }

  /**
   * Assist is opt-in, one-shot, and requires an injected proposer.
   */
  private canAssist(): boolean {
    return this.assistEnabled && this.repair !== undefined && !this.assistUsed;
  }

  /**
   * One bounded LLM repair, then rejoin the original path or stop.
   *
   * Sequence: freeze context → propose → policy-check each action → execute
   * within budget → original postconditions → next step's preconditions.
   * A second failure after this is not another assist (`assistUsed`).
   *
   * @returns `undefined` when execution rejoined; otherwise the unrepaired or new failure
   */
  private async maybeAssist(
    step: CapabilityStep,
    nextStep: CapabilityStep | undefined,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
    failure: ExecutionResult,
  ): Promise<ExecutionResult | undefined> {
    if (failure.status !== "failure" || !this.canAssist() || this.repair === undefined) {
      return failure;
    }
    if (this.currentCapability === undefined) {
      return failure;
    }
    this.assistUsed = true;
    // Freeze the current observation + failed step. This is not a new goal search.
    const observation = await this.surface.observe();
    const proposal = await this.repair.propose({
      step,
      capability: this.currentCapability,
      failure,
      observation,
    });
    let executed = 0;
    for (const raw of proposal.actions) {
      if (executed >= this.assistBudget) {
        // Budget is a hard stop. Remaining proposed actions are discarded.
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.unexpectedState,
          stepId: step.id,
          expected: { budget: this.assistBudget },
          observed: "assist budget exceeded",
          runId,
        };
      }
      const repairAction = hydrateAction(raw, inputs);
      const decision = this.policy?.check(repairAction) ?? { decision: "allow" as const };
      if (decision.decision !== "allow") {
        // Repair actions still go through PolicyGuard. Assist is not a bypass.
        return {
          status: "failure",
          capabilityId,
          code: ReplayFailureCode.policyBlocked,
          stepId: step.id,
          expected: repairAction,
          observed: decision,
          runId,
        };
      }
      await this.surface.execute(repairAction);
      executed += 1;
      await this.record(
        runId,
        ASSISTED_FALLBACK_EVENT,
        { action: repairAction, rationale: proposal.rationale },
        "agent",
      );
    }
    const post = await this.evaluatePostconditions(step, inputs, runId, capabilityId);
    if (post !== undefined) {
      return post;
    }
    if (nextStep !== undefined) {
      // Next original precondition is the rejoin gate. Failure here is not
      // another assist (`assistUsed` is already true).
      const pre = await this.evaluatePreconditions(nextStep, inputs, runId, capabilityId);
      if (pre !== undefined) {
        return pre;
      }
    }
    return undefined;
  }

  /**
   * Assert every postcondition. Domain classification is not this method:
   * {@link afterSuccessfulExecute} walks `possibleOutcomes` when the next
   * locator is missing (or last-step success misses).
   *
   * @returns `undefined` when postconditions hold; otherwise POSTCONDITION_FAILED
   */
  private async evaluatePostconditions(
    step: CapabilityStep,
    inputs: Record<string, unknown>,
    runId: string,
    capabilityId: string,
  ): Promise<ExecutionResult | undefined> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let failed: ReturnType<typeof hydrateAssertion> | undefined;
      for (const assertion of step.postconditions) {
        const expected = hydrateAssertion(assertion, inputs);
        if (!(await this.surface.assert(expected))) {
          failed = expected;
          break;
        }
      }
      if (failed === undefined) {
        await this.record(runId, "postcondition", {
          stepId: step.id,
          status: "ok",
        });
        return undefined;
      }
      if (attempt < this.maxAttempts && (await this.recoverInterstitial(runId, attempt))) {
        continue;
      }
      await this.record(runId, "postcondition", {
        stepId: step.id,
        status: "failed",
        expected: failed,
      });
      return {
        status: "failure",
        capabilityId,
        code: ReplayFailureCode.postconditionFailed,
        stepId: step.id,
        expected: failed,
        observed: false,
        runId,
      };
    }
    return undefined;
  }

  /**
   * Dismiss a known interstitial and log recovery. Returns false when none match.
   *
   * Only the known copy is treated as recoverable. Arbitrary sleeps are not
   * the primary sync mechanism — assertions already bound-wait.
   */
  private async recoverInterstitial(runId: string, attempt: number): Promise<boolean> {
    for (const text of INTERSTITIAL_TEXTS) {
      const visible = await this.surface.assert({ type: "textVisible", value: text });
      if (!visible) {
        continue;
      }
      const decision = this.policy?.check(INTERSTITIAL_CONTINUE) ?? { decision: "allow" as const };
      if (decision.decision !== "allow") {
        // Policy can refuse the Continue click; treat as unrecoverable.
        return false;
      }
      await this.surface.execute(INTERSTITIAL_CONTINUE);
      await this.record(runId, "recovery", {
        reason: "known_interstitial",
        text,
        attempt,
      });
      return true;
    }
    return false;
  }

  /**
   * Transfer the same headed session to a human, then resume automation.
   *
   * @returns `false` when no {@link HandoffController} is injected
   */
  private async pauseForHuman(args: {
    runId: string;
    capabilityId: string;
    stepId: string;
    reason: "approval_required" | "unexpected_state" | "policy_block" | "hard_failure_recovery";
    message: string;
  }): Promise<boolean> {
    if (this.handoff === undefined) {
      // No controller: cannot pause. Caller maps this to policyBlocked.
      return false;
    }
    const intervention = {
      runId: args.runId,
      reason: args.reason,
      message: args.message,
      capabilityId: args.capabilityId,
      stepId: args.stepId,
    };
    await this.record(
      args.runId,
      "handoff_start",
      { reason: args.reason, message: args.message, stepId: args.stepId },
      "human",
    );
    await this.recordHandoffObservation(args.runId, "before");
    await this.handoff.request(intervention);
    await this.surface.handoffToHuman();
    // Session stays open. waitForResume blocks until the operator continues.
    await this.handoff.waitForResume();
    await this.record(args.runId, "resume_signal", { stepId: args.stepId }, "human");
    await this.surface.resumeFromHuman();
    await this.recordHandoffObservation(args.runId, "after");
    await this.record(args.runId, "handoff_end", { stepId: args.stepId }, "human");
    return true;
  }

  /**
   * Resolve an in-page href before click so policy can deny off-origin destinations.
   *
   * Locator misses must not turn a policy check into a crash; omit the URL.
   */
  private async peekDestination(
    action: CapabilityAction,
  ): Promise<string | undefined> {
    if (!("target" in action)) {
      // navigate/handoff have no click target to peek.
      return undefined;
    }
    try {
      return await this.surface.peekDestination(action.target);
    } catch {
      return undefined;
    }
  }

  /**
   * Persist a classified failure plus screenshot/DOM when the writer is present.
   *
   * Observation capture is best-effort: a closed page still gets a summary
   * and a trace stub so operators are not left with an empty run folder.
   */
  private async captureFailureEvidence(
    result: Extract<ExecutionResult, { status: "failure" }>,
  ): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    const payload: Record<string, unknown> = {
      code: result.code,
      expected: result.expected,
      observed: result.observed,
    };
    if (result.stepId !== undefined) {
      payload.stepId = result.stepId;
    }
    await this.record(result.runId, "failure", payload);
    await this.captureBoundarySignal();
  }

  /**
   * Append JSONL for the terminal status, then write `summary.json`.
   *
   * Success stays a structured log. Stops (failure, business outcome) also
   * capture a surface snapshot. HITL snapshots are recorded at pause/resume.
   */
  private async finalizeEvidence(result: ExecutionResult): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    if (result.status === "failure") {
      await this.captureFailureEvidence(result);
    } else if (result.status === "business_outcome") {
      await this.record(result.runId, "business_outcome", {
        outcome: result.outcome,
        details: result.details,
      });
      await this.captureBoundarySignal();
    } else {
      await this.record(result.runId, "result", {
        status: "success",
        outputs: result.outputs,
      });
    }
    await this.evidence.writeSummary({
      runId: result.runId,
      runType: "replay",
      capabilityId: result.capabilityId,
      status: result.status,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      steps: this.completedSteps,
    });
  }

  /**
   * Observation + screenshot/DOM at a HITL boundary. Best-effort like failure.
   *
   * @param runId - Current run
   * @param phase - Pause (`before`) or resume (`after`)
   */
  private async recordHandoffObservation(
    runId: string,
    phase: "before" | "after",
  ): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    try {
      const observation = await this.surface.observe();
      await this.record(runId, "observation", { phase, observation }, "human");
      await this.persistBoundaryObservation(observation);
    } catch {
      await this.record(
        runId,
        "observation",
        { phase, error: "observe_failed" },
        "human",
      );
    }
  }

  /**
   * Screenshot and DOM at the current surface. Used for failure, HITL, and
   * business-outcome stops — not for successful checkpoints.
   */
  private async captureBoundarySignal(): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    try {
      await this.persistBoundaryObservation(await this.surface.observe());
    } catch {
      await this.evidence.captureRichSignal("trace", { reason: "observe_failed" });
    }
  }

  /**
   * Write DOM + screenshot for an already-captured observation.
   *
   * HITL calls this with the same observation it logged so pause does not
   * observe twice.
   *
   * @param observation - Current surface snapshot
   */
  private async persistBoundaryObservation(observation: Observation): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    await this.evidence.captureRichSignal(
      "dom",
      observation.accessibilitySnapshot ?? observation,
    );
    if (observation.imagePath !== undefined) {
      await this.evidence.captureRichSignal("screenshot", observation.imagePath);
    }
  }

  /**
   * Append one JSONL event. No-op when evidence is unwired so unit tests stay disk-free.
   *
   * The filesystem writer restamps `runType` from its constructor, so adaptation
   * runs stay tagged even though this engine always writes `replay` here.
   *
   * @param runId - Current run
   * @param type - Event type (checkpoint, recovery, HITL, or terminal)
   * @param payload - Optional structured body; redacted by the writer
   * @param actor - Who produced the event; HITL uses `"human"`
   */
  private async record(
    runId: string,
    type: string,
    payload?: unknown,
    actor: EvidenceActor = "replay",
  ): Promise<void> {
    if (this.evidence === undefined) {
      return;
    }
    await this.evidence.append({
      timestamp: new Date().toISOString(),
      runId,
      runType: "replay",
      type,
      actor,
      ...(payload === undefined ? {} : { payload }),
    });
  }
}

/**
 * HITL copy from the matched catalog entry. Heading is tool copy, not a locator.
 */
function hitlMessage(hit: MatchedPossibleOutcome): string {
  const parts = [hit.outcome.heading, hit.outcome.summary].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (parts.length > 0) {
    return parts.join(" — ");
  }
  return hit.phrase;
}
