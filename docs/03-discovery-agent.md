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

Avoid parsing free-form prose. The model should return schema-validated output such as:

```ts
interface CandidateAction {
  action: Action;
  rationale: string;
  rank: number;
  expectation?: string;
  risk?: "safe" | "risky";
}
```

Numeric confidence may be recorded but should not be treated as a calibrated probability. Ranking is the useful property.

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
  candidates?: CandidateAction[];
  triedCandidateIds: Set<string>;
  parent?: SearchNode;
}
```

Suggested limits:

- max total actions/steps;
- max depth;
- max candidates per state;
- overall timeout;
- repeated-state detection;
- maximum retries/backtracks.

Exact defaults should be tuned against the tenant app rather than over-designed in advance.

## Backtracking

Browser backtracking is not equivalent to popping an in-memory stack. `page.goBack()` may not restore SPA/modal/POST state. The runtime may therefore need one of:

- browser history when reliable;
- known checkpoints;
- return to the entry point and replay the known search prefix;
- surface-specific restore behavior.

The implementation may begin with a constrained reversible target app, but the design should acknowledge the distinction.

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

A capability must be decoupled from the raw model transcript. `CapabilityCompiler` performs a deliberate transformation:

1. identify the successful path;
2. remove failed exploration branches from the executable artifact;
3. retain failed branches only in evidence;
4. replace concrete discovery values with typed input references;
5. derive semantic target descriptors from successful actions;
6. derive preconditions and postconditions from meaningful observed state;
7. derive output extraction rules;
8. derive final success conditions;
9. attach schema/capability version metadata;
10. write the base artifact through `CapabilityRegistry.save` and a header-only tenant override through `saveOverride`.

Human actions require classification. A normal reusable approval boundary may become a handoff step. An exceptional manual recovery should usually remain evidence rather than being blindly compiled into the happy-path capability.

## Mastra's role

Mastra is used for the LLM/tool interaction layer, not as the owner of ICAS's artifact or replay semantics. ICAS should still own:

- search state;
- visited-state handling;
- branch ranking history;
- backtracking;
- search budget;
- trace format;
- capability compiler;
- surface abstraction;
- policy and evidence boundaries.

This keeps agent framework knowledge useful while preserving the system design as ICAS's architecture.
