# 00 — System Design (visual)

This note is the visual companion to the numbered design documents. It does not replace them. Contracts, schemas, and failure rules live in [`01`](01-system-overview.md)–[`12`](12-testing-and-demo.md). This file shows how those pieces sit together.

ICAS is a computer-use runtime for legacy banking UIs that do not expose useful APIs. The model spends reasoning only while a workflow is unknown. A successful discovery compiles into a reusable capability. Production execution is deterministic.

```text
The model discovers.
The artifact becomes the reusable capability.
Replay executes the known capability.
```

Unless a diagram is marked **stretch** or **not done**, it describes the designed system. Implementation status is in [`TODO.md`](../TODO.md) and in [§8 Scope](#8-scope-map).

---

## 1. How to read this file

Each section is one concern: a short paragraph, one or two Mermaid diagrams, and a link to the detailed note. Shapes are a locked legend. Color is secondary; GitHub dark mode may wash fills. Shape plus label carry the meaning.

Do not treat a box as “implemented and demo-proven” unless §8 says so. Phase 8 still requires real discovery/replay artifacts; do not hand-author `capabilities/` to fake that proof.

### Shape legend

```mermaid
flowchart LR
  subgraph legend["Legend"]
    direction TB
    app([thin app / CLI])
    mod[runtime module]
    seam(interface / seam)
    art[(on-disk artifact)]
    ev[/run evidence/]
    llm{{LLM / model}}
    gate{gate / decision}
    human((human))
    ext[[external UI / tenant]]
  end

  classDef optional stroke-dasharray: 6 4
  classDef todo stroke-dasharray: 2 2
```

| Kind | Shape | Examples |
|---|---|---|
| Thin app / CLI | stadium | `icas-agent`, `icas-play`, `icas-adapt`, `icas-mcp` |
| Runtime module | rectangle | `ReplayEngine`, `CapabilityCompiler`, `PolicyGuard` |
| Interface / seam | rounded | `Surface`, `CapabilityRegistry` |
| On-disk artifact | cylinder | `capability.json`, tenant override |
| Run evidence | parallelogram | `trace.jsonl`, `log.jsonl`, screenshots |
| LLM / model | hexagon | `CandidateProposer`, `RepairProposer` |
| Gate / decision | diamond | `PolicyGuard`, locator found?, enrolled? |
| Human | circle | operator, CLI prompt, browser takeover |
| External UI | subroutine | `icas-bank`, `loki-bank`, headed browser |

Line and subgraph conventions:

- **solid** — must-have path
- **dashed** (`-.->`, dashed subgraph) — in-repo stretch (`--assist`, `icas-adapt`, MCP)
- **dotted** + `TODO` in the label — designed, not done (see §8)

---

## 2. System context

An operator runs ICAS against synthetic tenant apps. An agent host is an optional second caller through MCP. There is no production co-browsing console, no worker queue, and no real bank.

```mermaid
flowchart LR
  operator((operator))
  host([agent host])
  icas[ICAS]
  bank[["icas-bank :4101"]]
  loki[["loki-bank :4102"]]

  operator -->|"discover / play / adapt"| icas
  host -.->|"MCP tools"| icas
  icas --> bank
  icas --> loki

  classDef optional stroke-dasharray: 6 4
  class host optional
```

Both tenants are the same fictional Vendor+Product (`icas-bank` / `icas-bank`). Loki Bank is a second install with small label/nav drift, not a second product. See [`01-system-overview.md`](01-system-overview.md) and [`06-multi-tenant-and-adaptation.md`](06-multi-tenant-and-adaptation.md).

---

## 3. High-level architecture

Apps stay thin. Behavior lives in packages. The catalog is the join between authoring and execution. Replay never reads `capabilities/` itself; it receives an **effective** capability from `CapabilityResolver`. Playwright is the first `Surface` implementation, not the artifact model.

```mermaid
flowchart TB
  subgraph apps["Apps"]
    direction LR
    agent([icas-agent])
    play([icas-play])
    adapt([icas-adapt])
    mcp([icas-mcp])
  end

  subgraph authoring["Authoring"]
    disc[DiscoveryAgent]
    llmDisc{{CandidateProposer}}
    compiler[CapabilityCompiler]
    disc --> llmDisc
    disc --> compiler
  end

  subgraph catalog["Catalog"]
    registry(CapabilityRegistry)
    resolver[CapabilityResolver]
    base[("capabilities/id/capability.json")]
    ov[("overrides/tenant.json")]
    registry --> base
    registry --> ov
    resolver --> registry
  end

  subgraph execution["Execution"]
    engine[ReplayEngine]
    assist{{RepairProposer}}
    engine -.-> assist
  end

  subgraph shared["Shared runtime"]
    policy[PolicyGuard]
    redactor[Redactor]
    handoff[HandoffController]
    evidence[EvidenceWriter]
  end

  subgraph surfaceBox["Surface"]
    seam(Surface)
    pw[PlaywrightSurface]
    seam --> pw
  end

  subgraph tenants["Tenants"]
    bank[["icas-bank"]]
    loki[["loki-bank"]]
  end

  agent --> disc
  compiler --> registry
  play --> resolver
  mcp -.-> resolver
  adapt -.-> resolver
  adapt -.-> disc
  resolver --> engine
  engine --> policy
  disc --> policy
  policy --> seam
  engine --> handoff
  disc --> handoff
  disc --> evidence
  engine --> evidence
  evidence --> redactor
  pw --> bank
  pw --> loki

  classDef optional stroke-dasharray: 6 4
  class mcp,adapt,assist optional
```

`FileSystemCapabilityRegistry({ root })` is the only catalog backend. The `CapabilityRegistry` interface stays; a REST/DB backend is out of scope. See [`02-repository-structure.md`](02-repository-structure.md).

---

## 4. Core invariant / lifecycle

Discovery always discovers. It does not silently replay. Replay selects by **capability id**. `--url` only opens the surface. Vendor, product, and tenant default to `icas-bank`; ICAS does not infer them from the URL.

First discover writes the Vendor+Product **base** and a **header-only** override for the discovering tenant (`overrides: {}`). Production replay (`icas-play` / MCP) fails if that tenant is not enrolled.

```mermaid
flowchart LR
  goal["goal + URL + id"]
  disc[discover]
  llm{{LLM}}
  trace[/discovery trace/]
  compile[compile]
  base[("base capability")]
  header[("header-only override")]
  enroll{tenant enrolled?}
  resolve[resolve]
  effective["effective capability"]
  replay[ReplayEngine]
  assist{{"--assist"}}

  goal --> disc
  disc --> llm
  disc --> trace
  trace --> compile
  compile --> base
  compile --> header
  base --> resolve
  header --> enroll
  enroll -->|yes| resolve
  enroll -->|no| fail["fail closed"]
  resolve --> effective
  effective --> replay
  replay -.-> assist

  classDef optional stroke-dasharray: 6 4
  class assist optional
```

`icas-adapt` is a third lifecycle, not a second discover: guarded replay against another tenant, then header-only enrollment or a small declarative patch. See [§5.8](#58-multi-tenant--adapt).

---

## 5. Subsystems

### 5.1 Discovery and compiler

`icas-agent` observes the live surface, asks the model for ranked structured candidates, executes only what policy allows, and searches with an explicit ICAS-owned graph (budgets, backtrack, repeated-state). Mastra is the LLM/tool layer. Search state does not live in Mastra memory.

A capability is not a transcript. The compiler keeps the successful path only. Failed DFS branches stay evidence. Fill/select parameters are named by the proposer (`proposedInputParam`); the compiler aggregates them onto the artifact. Discover does not take typed invocation flags.

```mermaid
flowchart TB
  req["DiscoveryRequest: id, url, goal"]
  observe[observe Surface]
  snap[/Observation + screenshot/]
  propose{{CandidateProposer}}
  policy{PolicyGuard}
  exec[execute]
  search[search controller]
  hitl((human))
  budget{success or stop?}
  trace[/trace.jsonl/]
  compile[CapabilityCompiler]
  base[("capability.json")]
  ov[("overrides/tenant.json")]

  req --> observe
  observe --> snap
  snap --> propose
  propose --> policy
  policy -->|allow| exec
  policy -->|deny / risky| hitl
  exec --> search
  hitl --> search
  search --> budget
  budget -->|continue| observe
  budget -->|success| compile
  search --> trace
  compile --> base
  compile --> ov
  snap -.-> pixels
  pixels["TODO 5.22: send screenshot pixels"]

  classDef todo stroke-dasharray: 2 2
  class pixels todo
```

Vision-capable default is `openai/gpt-4o`. Today `generate` still embeds `imagePath` as text (Pass 5.22). Compile copies `error` and `hitl` `possibleOutcomes` onto the step and drops `kind: "success"` (Pass 5.19). Replay classification is Pass 4.14. Details: [`03-discovery-agent.md`](03-discovery-agent.md).

### 5.2 Catalog and resolve

Identity is catalog `id` only (for example `loan-payoff`). Vendor+Product is the app family. Tenant identity lives on the override, not on every route in the base.

Callers must not glob `capabilities/`. `@icas/capability` owns schema, validation, CRUD, overrides, and resolve.

```mermaid
flowchart TB
  id["catalog id: loan-payoff"]
  base[("capability.json")]
  icasOv[("overrides/icas-bank.json")]
  lokiOv[("overrides/loki-bank.json")]
  resolver[CapabilityResolver]
  enrolled{override exists?}
  effective["effective capability"]
  engine[ReplayEngine]

  id --> base
  id --> icasOv
  id --> lokiOv
  base --> resolver
  icasOv --> enrolled
  lokiOv --> enrolled
  enrolled -->|yes| resolver
  enrolled -->|no| fail["icas-play / MCP fail closed"]
  resolver --> effective
  effective --> engine
```

Header-only `overrides: {}` is valid enrollment. `ReplayEngine` stays tenant-agnostic: no tenant `if/else`, no hardcoded product error table. Details: [`04-capability-artifact.md`](04-capability-artifact.md).

### 5.3 Replay

`ReplayEngine` is the production path shared by `icas-play`, `icas-mcp`, and `icas-adapt` verification. Strict replay has no LLM. Every action still goes through `PolicyGuard`.

Result taxonomy: `success` | `business_outcome` | `failure`. Business outcomes are expected application answers, not crashes. Hard failures capture rich evidence and stop.

```mermaid
flowchart TB
  step["current step"]
  pre[preconditions]
  policy{PolicyGuard}
  exec[execute via Surface]
  last{last step?}
  nextLoc{next step locator found?}
  http["TODO 4.16: document HTTP 403/404/5xx"]
  outcomes["possibleOutcomes on this step"]
  generic["TODO 4.16: runtime generic chrome"]
  success[overall success + extract outputs]
  resultSuccess["success"]
  resultBiz["business_outcome"]
  resultHitl((HITL))
  resultFail["failure"]
  assist{{"--assist repair then rejoin"}}

  step --> pre
  pre -->|fail| resultFail
  pre --> policy
  policy -->|deny| resultFail
  policy -->|require human| resultHitl
  policy -->|allow| exec
  exec --> last
  last -->|no| nextLoc
  last -->|yes| success
  nextLoc -->|found| step
  nextLoc -->|missing| http
  http --> outcomes
  outcomes -->|kind error| resultBiz
  outcomes -->|kind hitl| resultHitl
  outcomes -->|none| generic
  generic -->|none| resultFail
  success -->|ok| resultSuccess
  success -->|miss| http
  resultFail -.-> assist

  classDef optional stroke-dasharray: 6 4
  classDef todo stroke-dasharray: 2 2
  class assist optional
  class http,outcomes,generic todo
```

Until Passes 1.10 / 4.14 / 4.16 land, replay still uses the earlier hardcoded loan-copy table. Phrase embeddings (Pass 4.15) are deferred: same `match.phrases` field, no vectors on the artifact, still no LLM on strict replay. Details: [`05-replay-engine.md`](05-replay-engine.md).

### 5.4 Surface

The artifact speaks semantic actions, targets, assertions, and outputs. `PlaywrightSurface` is the implemented driver. Desktop/accessibility stays a future mapping behind the same seam; this prototype does not implement a second driver.

```mermaid
flowchart TB
  callers["Discovery / Replay / Handoff"]
  seam(Surface)
  pw[PlaywrightSurface]
  browser[["headed browser session"]]
  bank[["icas-bank"]]
  loki[["loki-bank"]]
  desktop["desktop / a11y driver"]

  callers --> seam
  seam --> pw
  pw --> browser
  browser --> bank
  browser --> loki
  seam -.-> desktop

  classDef todo stroke-dasharray: 2 2
  class desktop todo
```

Target resolution is ranked: `roleText`, `visibleText`, `label`, then `relative` / `css` / `xpath`. Coordinates are last resort. HTTP status on `Observation` is Pass 2.10 (needed by replay 4.16). Details: [`10-surface-abstraction.md`](10-surface-abstraction.md).

### 5.5 Safety

Three independent layers. Prompt text influences what the model proposes. `PolicyGuard` enforces what may execute. `Redactor` controls what may leave memory or be persisted. Prompt policy is not enforcement.

```mermaid
flowchart LR
  src["LLM candidate or capability step"]
  prompt[/prompt policy markdown/]
  guard{PolicyGuard}
  allow[allow]
  deny[deny]
  human((require human))
  surface(Surface)
  redactor[Redactor]
  evidence[/evidence on disk/]
  llm{{model payload}}
  term[/terminal output/]

  prompt -.->|"instructs"| src
  src --> guard
  guard --> allow
  guard --> deny
  guard --> human
  allow --> surface
  surface --> redactor
  redactor --> evidence
  redactor --> llm
  redactor --> term
```

Runtime checks include action allowlist, in-origin vs off-origin (peek destination before click, then resulting navigation), and independent risky-control text (do not trust model self-classification). Saved artifacts must not contain credentials, tokens, or raw sensitive data. Details: [`08-safety-policy.md`](08-safety-policy.md).

### 5.6 Handoff

Handoff is control transfer of the **same** headed session. It is not a yes/no modal alone and not a co-browsing console.

Two forms: CLI approval/input, and browser takeover (human uses the existing Playwright window, then ENTER). Ownership is explicit: `automation` | `human`. Automation actions are rejected while a human owns the session.

```mermaid
stateDiagram-v2
  [*] --> automation
  automation --> human: request intervention
  human --> automation: resume signal
  automation --> [*]: run ends
  human --> [*]: run ends while paused
```

Discovery requests HITL when stuck, ambiguous, risky, or policy-blocked. Replay requests HITL when policy requires it, state is unrecoverable, assist is disabled/exhausted, or a compiled `possibleOutcomes` entry with `kind: "hitl"` matches. Details: [`07-human-handoff.md`](07-human-handoff.md).

### 5.7 Evidence

A capability is persistent knowledge. Every discovery, replay, or adaptation is a **run** with its own directory. Persist only after `Redactor`.

```mermaid
flowchart TB
  run["runId"]
  discDir["evidence/id/runId/"]
  trace[/trace.jsonl/]
  log[/log.jsonl/]
  summary[("summary.json")]
  obs[/observations/*.png/]

  run --> discDir
  discDir --> trace
  discDir --> log
  discDir --> summary
  discDir --> obs
```

Discovery traces are the richest (observations, ranked candidates, policy, backtrack, intervention). Replay writes checkpoint JSONL on every terminal status; screenshots on failure, HITL, and business-outcome stops — not on success. Details: [`09-evidence-observability.md`](09-evidence-observability.md).

### 5.8 Multi-tenant / adapt

```text
Vendor → Product → Tenant
```

Same Vendor+Product is a reuse **hint**, not proof. `icas-adapt` runs guarded replay against a new tenant URL. Compatible → header-only override (`createdBy: "verified"`). Small drift → declarative patch (`createdBy: "icas-adapt"`) and re-verify. Large divergence → abort; do not accumulate a brittle patch. Rediscover is a separate `icas-agent` run, not a giant override.

```mermaid
flowchart TB
  base[("base capability")]
  adapt([icas-adapt])
  url[["new tenant URL"]]
  engine[ReplayEngine]
  match{checkpoints pass?}
  header[("header-only override")]
  patch[("declarative patch")]
  reverify[re-verify]
  abort[abort to rediscover]
  disc[bounded discover around drift]

  base --> adapt
  url --> adapt
  adapt --> engine
  engine --> match
  match -->|yes| header
  match -->|small drift| disc
  match -->|large drift| abort
  disc --> patch
  patch --> reverify
  reverify -->|pass| patch
  reverify -->|fail| abort

  classDef optional stroke-dasharray: 6 4
  class adapt,disc optional
```

`icas-play` / MCP must not silently use the bare base for an unenrolled tenant. Details: [`06-multi-tenant-and-adaptation.md`](06-multi-tenant-and-adaptation.md).

### 5.9 MCP (stretch)

`icas-play` is the human CLI. `icas-mcp` is the agent-facing adapter over the **same** registry, resolver, and `ReplayEngine`. Stdio transport for the local demo. One tool per saved capability; typed args from compiled `inputs`. Tenant must already be enrolled (default `icas-bank`).

No separate MCP diagram: it is the dashed `icas-mcp` node on [§3](#3-high-level-architecture). Pass 6.13 still needs to surface `heading` / `summary` from a matched `possibleOutcomes` entry on `business_outcome`. Details: [`11-agent-facing-mcp.md`](11-agent-facing-mcp.md).

---

## 6. Cross-cutting sequences

### Discover (must)

```mermaid
sequenceDiagram
  actor Op as operator
  participant Agent as icas-agent
  participant Disc as DiscoveryAgent
  participant Surf as Surface
  participant LLM as CandidateProposer
  participant Pol as PolicyGuard
  participant Comp as Compiler
  participant Reg as Registry

  Op->>Agent: discover with id, url, goal
  Agent->>Disc: DiscoveryRequest
  loop until success or budget
    Disc->>Surf: observe
    Surf-->>Disc: Observation
    Disc->>LLM: goal + observation + policy
    LLM-->>Disc: ranked CandidateAction
    Disc->>Pol: proposed action
    Pol-->>Disc: allow / deny / human
    Disc->>Surf: execute
    Disc->>Disc: append trace
  end
  Disc->>Comp: successful path
  Comp->>Reg: save base
  Comp->>Reg: saveOverride header-only
```

### Strict replay (must)

```mermaid
sequenceDiagram
  actor Op as operator
  participant Play as icas-play / MCP
  participant Res as CapabilityResolver
  participant Eng as ReplayEngine
  participant Pol as PolicyGuard
  participant Surf as Surface

  Op->>Play: run id, url, typed params
  Play->>Res: resolve id + tenant
  alt not enrolled
    Res-->>Play: fail closed
  else enrolled
    Res-->>Play: effective capability
    Play->>Eng: run effective + inputs
    loop each step
      Eng->>Surf: assert preconditions
      Eng->>Pol: action
      Pol-->>Eng: allow
      Eng->>Surf: execute
      Eng->>Surf: assert / locate next
    end
    Eng-->>Play: success / business_outcome / failure
  end
```

MCP follows the same replay sequence. The host supplies tool arguments instead of CLI flags.

### Adapt (stretch)

```mermaid
sequenceDiagram
  actor Op as operator
  participant Adapt as icas-adapt
  participant Eng as ReplayEngine
  participant Disc as DiscoveryAgent
  participant Reg as Registry

  Op->>Adapt: loan-payoff, tenant loki-bank, url
  Adapt->>Eng: guarded replay of base
  alt all checkpoints pass
    Adapt->>Reg: header-only override verified
  else small drift
    Adapt->>Disc: bounded specialize around mismatch
    Disc-->>Adapt: declarative patch
    Adapt->>Eng: re-verify resolved capability
    Adapt->>Reg: saveOverride icas-adapt
  else large divergence
    Adapt-->>Op: abort — rediscover instead
  end
```

---

## 7. Package dependency direction

Dependencies flow inward toward reusable contracts. Core packages do not import CLIs.

```mermaid
flowchart TB
  agent([icas-agent])
  play([icas-play])
  adapt([icas-adapt])
  mcp([icas-mcp])

  discovery[discovery]
  replay[replay]
  capability[capability]
  surface[surface]
  browser[browser]
  policy[policy]
  redactor[redactor]
  handoff[handoff]
  evidence[evidence]

  agent --> discovery
  agent --> capability
  agent --> surface
  play --> replay
  play --> capability
  play --> surface
  adapt --> replay
  adapt --> discovery
  adapt --> capability
  mcp --> capability
  mcp --> replay
  discovery --> capability
  discovery --> surface
  replay --> capability
  replay --> surface
  browser --> surface
  browser --> capability
  discovery --> policy
  replay --> policy
  discovery --> redactor
  replay --> redactor
  discovery --> handoff
  replay --> handoff
  discovery --> evidence
  replay --> evidence
```

Workspace layout and naming: [`02-repository-structure.md`](02-repository-structure.md).

---

## 8. Scope map

The must-have slice is the vertical path a reviewer can defend: real LLM discovery, compiled artifact, enrolled tenant, deterministic replay with structured errors, same-session HITL, redacted evidence. Stretch is in-repo by design. Do not skip the must-have slice to polish extras.

```mermaid
flowchart TB
  subgraph must["Must-have slice"]
    m1[discover with real LLM]
    m2[compile capability]
    m3[enroll tenant override]
    m4[strict ReplayEngine]
    m5[structured errors]
    m6[HITL same session]
    m7[redact then evidence]
    m1 --> m2 --> m3 --> m4
    m4 --> m5
    m4 --> m6
    m4 --> m7
  end

  subgraph stretch["In-repo stretch"]
    s1["icas-play --assist"]
    s2[icas-adapt]
    s3[icas-mcp]
    s4[browser takeover]
  end

  subgraph out["Out of scope"]
    o1[co-browsing console]
    o2[queues / workers]
    o3[real bank credentials / PII]
    o4[second surface driver]
    o5[REST / DB registry]
    o6[infer identity from URL]
  end

  subgraph remaining["Designed, not done"]
    r1["possibleOutcomes compile + classify"]
    r2["2.10 / 4.16 HTTP + generic chrome"]
    r3["4.15 phrase embeddings — deferred"]
    r4["5.22 screenshot pixels in generate"]
    r5["6.13 MCP heading/summary"]
    r6["Phase 8 real run artifacts"]
    r7["Phase 9 distill REPORT.md"]
  end
```

| Bucket | What | Notes |
|---|---|---|
| Must | Discover → artifact → enroll → replay + errors → HITL → evidence | [`01`](01-system-overview.md), Phases 1–5 and 6.1–6.5 |
| Stretch | `--assist`, `icas-adapt`, MCP, browser takeover | Built in-repo; draw dashed. MCP `business_outcome` copy still open (6.13) |
| Out | Co-browsing console, queues, real PII, desktop driver, REST/DB registry, URL inference | Keep the `Surface` and `CapabilityRegistry` seams; do not implement the extras |
| Remaining | HTTP status, vision pixels, Phase 8 evidence, `REPORT.md` | See [`TODO.md`](../TODO.md). Pass 4.15 is deferred on purpose |

Synthetic tenants `icas-bank` and `loki-bank` are in (Phase 7). The first concrete capability remains: generate a loan payoff statement for `loanAccountId` + `payoffDate`, extracting `totalPayoffAmount`, `principalBalance`, and `perDiemInterest`. Discovery must learn that path from the live UI; it must not hard-code it.

Reviewer-facing seven headings stay in [`REPORT.md`](../REPORT.md) (still a scaffold until Pass 9.1). Demo commands live in the root README; they must match a real run before Phase 8 is closed. Testing philosophy: [`12-testing-and-demo.md`](12-testing-and-demo.md).
