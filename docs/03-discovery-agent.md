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

The initial implementation is expected to favor rendered visual observation because legacy banking surfaces may have poor/non-semantic DOMs. Playwright can capture a full-page rendered image. DOM/accessibility information may be added as supplementary context, but discovery must not assume clean selectors or test IDs.

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

interface CandidateAction {
  id?: string; // assigned by ICAS when omitted
  action: Action; // click | fill | select | navigate | read | handoff
  rationale: string;
  rank: number; // 1 is tried before 2
  expectation?: string;
  risk?: "safe" | "risky";
}
```

- `continue` — try `candidates` in rank order (at least one required).
- `success` — the current observation already satisfies the goal; `candidates` may be empty.
- `stuck` — do not improvise; the search controller requests HITL.

A string transcript, an unknown `action.type`, or `continue` with zero candidates is a validation error. Numeric confidence may be recorded but is not a calibrated probability. Ranking is the useful property.

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

Exact defaults should be tuned against the tenant app rather than over-designed in advance. The controller stores this graph in ICAS memory, not in Mastra conversation state.

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
- ranked candidates where useful;
- chosen action;
- policy decision;
- surface action result;
- state assessment;
- backtracks/dead ends;
- human interventions;
- final success.

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
7. derive output extraction rules;
8. derive final success conditions;
9. attach schema/capability version metadata;
10. write the base artifact through `CapabilityRegistry.save` (refuse if `id@version` already exists unless `capabilityVersion` is bumped) and a header-only tenant override through `saveOverride` (`createdBy: "discovery"`). Tests use a temp registry root, never repo `capabilities/`.

Human actions require classification. A normal reusable approval boundary may become a handoff step. An exceptional manual recovery should usually remain evidence rather than being blindly compiled into the happy-path capability.

## Mastra's role

Mastra is the LLM/tool layer, not the owner of ICAS search or artifacts.

- Construct `new Agent({ id, name, instructions, model })` with `model` as `'provider/model'` (e.g. `openai/gpt-4o`).
- Call `agent.generate(prompt, { structuredOutput: { schema: CandidateProposalSchema } })` **once per DFS node**.
- Do not give the agent click/fill tools. ICAS policy-checks and executes.
- Do not store the search graph in Mastra Memory. `SearchNode` parent/tried sets live in `DiscoveryAgent`.

Default discovery model is `openai/gpt-4o` (vision-capable for `observation.imagePath`). Override with `ICAS_MODEL`. Provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Live smoke is `ICAS_DISCOVERY_SMOKE=1` and is off in CI.

ICAS still owns: search state, visited-state handling, branch ranking, backtracking, budget, trace, compiler, surface, policy, and evidence.
