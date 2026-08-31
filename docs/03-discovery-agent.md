# 03 — Discovery Agent

## Responsibility

`icas-agent` always performs discovery. It does not silently choose between replay and discovery. This keeps the command semantically clear and makes it easy to demonstrate that the discovery run is genuinely LLM-driven.

## Inputs

```ts
interface DiscoveryRequest {
  id: string; // unique catalog id, e.g. "loan-payoff"
  target: {
    vendor: string; // CLI default "icas-bank"
    product: string; // CLI default "icas-bank"
    tenant: string; // CLI default "icas-bank"
    url: string;
  };
  goal: string;
}
```

`--id`, `--url`, and `--goal` are required. Vendor, product, and tenant may be omitted on the CLI; each defaults to `icas-bank`. ICAS is not responsible for inferring vendor, product, tenant, or capability id from the URL.

`--id` is unique in the catalog. It names the Vendor+Product capability, not a tenant copy. A later institution uses `icas-adapt --id loan-payoff --tenant loki-bank`, not a second discover with a new id.

On success the compiler:

1. `save`s the base artifact under that id (refuse if the id already exists, unless the caller explicitly bumps `capabilityVersion`);
2. `saveOverride`s a header-only tenant override for `target.tenant` with `overrides: {}` and `createdBy: "discovery"`.

## Observation model

The initial implementation is expected to favor rendered visual observation because bank and credit union **staff** back-office surfaces are often legacy (poor or non-semantic DOM). Playwright can capture a full-page rendered image. DOM/accessibility information may be added as supplementary context, but discovery must not assume clean selectors or test IDs.

The observation is surface-neutral:

```ts
interface Observation {
  id: string;
  url?: string;
  imagePath?: string;
  accessibilitySnapshot?: unknown;
  metadata?: Record<string, unknown>;
}
```

## Agent loop

The discovery process is not a pre-programmed flow. At each state:

1. capture current observation;
2. send goal + observation + relevant search history + prompt policy to the model;
3. receive structured candidate action(s);
4. validate the proposed action through runtime policy;
5. execute through the surface;
6. capture the resulting observation;
7. assess progress / dead-end / completion;
8. record evidence;
9. continue until success or a stopping condition.

## Structured model output

Avoid parsing free-form prose. Every proposer call (Mastra `Agent.generate` with `structuredOutput`, or a test fake) must return **one JSON object** matching `CandidateProposal`:

```ts
type CandidateProposal = {
  status: "continue" | "success" | "stuck";
  candidates: CandidateAction[];
  rationale?: string;
};

interface PossibleOutcome {
  kind: "success" | "error" | "hitl";
  match: string; // phrase replay may look for on the page; not a paragraph
  heading: string | null; // tool / HITL title; never used as a locator
  summary: string | null; // tool / HITL body; never used as a locator
}

interface CandidateAction {
  id?: string; // assigned by ICAS when omitted
  action: Action; // click | fill | select | navigate | read | handoff
  rationale: string;
  rank: number; // 1 is tried before 2
  expectation?: string; // optional current-snapshot chrome; not an error catalog
  possibleOutcomes: PossibleOutcome[]; // ordered; first matching `match` wins at replay
  risk?: "safe" | "risky";
}
```

- `continue` — try `candidates` in rank order (at least one required).
- `success` — the current observation already satisfies the goal; `candidates` may be empty.
- `stuck` — do not improvise; the search controller requests HITL.

### `possibleOutcomes`

These are **unverified guesses** from the goal, search history, and this snapshot. Discovery does **not** run extra error-path goals and merge them into one capability. One successful discover still compiles **one** linear happy path. Failed DFS branches stay evidence-only.

The model may include a happy-path entry (`kind: "success"`). Compile **drops** those. Replay **ignores** `success` on the locator-miss path. Locators on the **next** step are how replay knows the happy path continued.

`kind` is only about **who can finish the run**, not a catalog of product messages:

- `success` — this outcome means the goal completed (not used when the next locator misses).
- `error` — the application has already answered; the caller can stop. No person needs this session.
- `hitl` — automation cannot continue; a person must operate the **same** session.

`match` is the only field replay searches for (visible text). `heading` and `summary` are for `icas-play` / MCP / HITL copy. Array **order** is priority: specific phrases before generic ones. Empty `possibleOutcomes` is valid.

Do not put sample error sentences, loan-specific codes, or a closed enum of domain results in the proposer **instructions**. Instructions set environment (bank and credit union **staff** back-office, often legacy, no API) and the JSON contract. The **user** message supplies `--goal` and the current observation.

Optional `expectation` is not this catalog. It must not narrate success or embed invocation values. See [`04-capability-artifact.md`](04-capability-artifact.md) and [`05-replay-engine.md`](05-replay-engine.md) for how compile and replay use `possibleOutcomes`.

A string transcript, an unknown `action.type`, or `continue` with zero candidates is a validation error. Numeric confidence may be recorded but is not a calibrated probability. Ranking is the useful property.

OpenAI structured output cannot use `oneOf`, so generate uses a flat action schema and ICAS maps it onto catalog `CapabilityAction`. For fill/select/read, that map appends a `relative` fallback when the model used `label` or `visibleText` for a field caption: core banking screens often put the name in a table cell, not an associated `<label>`, so Playwright `getByLabel` misses the adjacent input.

## Bounded graph search

UI navigation is modeled as heuristic-guided search over dynamically discovered states. A full generic graph-search framework is unnecessary, but the controller should own explicit state rather than trusting conversation memory alone.

Conceptually this is confidence-ordered DFS:

```text
HOME
├── Loans                 rank 1
├── Lending Services      rank 2
└── Documents             rank 3

Try highest-ranked untried branch.
If dead end, backtrack and try the next sibling.
```

Suggested state:

```ts
interface SearchNode {
  stateId: string;
  observation: Observation;
  candidates: CandidateAction[];
  triedCandidateIds: Set<string>;
  parent?: SearchNode;
  depth: number;
}
```

Suggested limits (`resolveSearchBudget`, defaults for a synthetic tenant):

- max total actions/steps (40);
- max depth (20);
- max candidates per state (5);
- overall timeout (120s);
- repeated-state detection;
- maximum retries/backtracks.

Exact defaults should be tuned against the tenant app rather than over-designed in advance. The controller stores this graph in ICAS memory, not in Mastra conversation state. Repeated-state identity is URL plus an accessibility-snapshot fingerprint when present, so fill/select on the same page is not treated as a cycle.

## Backtracking

Browser backtracking is not equivalent to popping an in-memory stack. `page.goBack()` may not restore SPA/modal/POST state. The runtime may therefore need one of:

- browser history when reliable;
- known checkpoints;
- return to the entry point and replay the known search prefix;
- surface-specific restore behavior.

The runtime therefore restores by returning to the entry URL and replaying the known successful prefix. It does not call `page.goBack()`.

## Human handoff during discovery

If search is stuck, ambiguous, risky, or outside policy, the controller emits an intervention request. Automation pauses. A human may answer a CLI question or operate the same headed browser directly. Human actions/state changes are recorded as evidence and control returns explicitly.

## Discovery trace

Discovery evidence is intentionally richer than replay evidence. The trace should capture:

- observations;
- model decisions/rationale;
- ranked candidates (full actions, not only a count);
- chosen action;
- policy decision;
- surface action result;
- state assessment;
- backtracks/dead ends;
- human interventions;
- final success.

`icas-agent discover` also prints each observation (ARIA snapshot preview), agent instructions (once), the LLM user prompt, the LLM proposal JSON, and the chosen action to stderr. A thrown surface error (`TARGET_NOT_FOUND`) becomes a failed `action_result` with that message so the run still writes evidence.

The trace is append-only JSONL plus referenced screenshots/observations.

## Trace → capability compiler

A capability must be decoupled from the raw model transcript. `CapabilityCompiler.compile` reads in-memory events or a JSONL `tracePath` and reconstructs the executable path as a stack: an ok `action_result` pushes the preceding `chosen_action`; `backtrack` pops. Failed branches remain evidence-only.

`CapabilityCompiler` then performs a deliberate transformation:

1. identify the successful path;
2. remove failed exploration branches from the executable artifact;
3. retain failed branches only in evidence;
4. replace concrete discovery values with typed input references (`inputValues` maps e.g. `987654` → `{ input: "loanAccountId" }`);
5. derive semantic target descriptors from successful actions;
6. derive preconditions and postconditions from meaningful observed state;
7. copy this step’s `possibleOutcomes` (`error` and `hitl` only, same order) onto the compiled step;
8. derive output extraction rules;
9. derive final success conditions;
10. attach schema/capability version metadata;
11. write the base artifact through `CapabilityRegistry.save` (refuse if `id@version` already exists unless `capabilityVersion` is bumped) and a header-only tenant override through `saveOverride` (`createdBy: "discovery"`). Tests use a temp registry root, never repo `capabilities/`.

Human actions require classification. A normal reusable approval boundary (`approval_required`) becomes an explicit `handoff` step on the success path. An exceptional manual recovery (`policy_block`, `discovery_stuck`) remains evidence rather than being compiled into the happy-path capability.

## Mastra's role

Mastra is the LLM/tool layer, not the owner of ICAS search or artifacts.

- Construct `new Agent({ id, name, instructions, model })` with `model` as `'provider/model'` (e.g. `openai/gpt-4o`).
- `instructions` are the **system** contract: staff back-office at banks and credit unions (not consumer banking), often legacy surfaces, JSON shape including `possibleOutcomes`, locator rules, policy text. They must stay goal-agnostic.
- Call `agent.generate(prompt, { structuredOutput: { schema: … } })` **once per DFS node**. That `prompt` is the **user** turn: goal, this observation, search history.
- `icas-agent discover` logs instructions once (`LLM agent instructions`) and each user turn (`LLM user prompt`).
- Do not give the agent click/fill tools. ICAS policy-checks and executes.
- Do not store the search graph in Mastra Memory. `SearchNode` parent/tried sets live in `DiscoveryAgent`.

Default discovery model is `openai/gpt-4o` (vision-capable for `observation.imagePath`). Override with `ICAS_MODEL`. Provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Live smoke is `ICAS_DISCOVERY_SMOKE=1` and is off in CI.

ICAS still owns: search state, visited-state handling, branch ranking, backtracking, budget, trace, compiler, surface, policy, and evidence.
