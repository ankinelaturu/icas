# 00 — System Design

ICAS is a computer-use runtime for legacy banking UIs that do not expose useful APIs. The model spends reasoning only while a workflow is unknown. A successful discovery compiles into a reusable capability. Production execution is deterministic.

```text
The model discovers.
The artifact becomes the reusable capability.
Replay executes the known capability.
```

Contracts and failure rules: [`01`](01-system-overview.md)–[`12`](12-testing-and-demo.md). Implementation status: [`TODO.md`](../TODO.md).

---

## 1. Architecture

![ICAS architecture](icas.excalidraw.svg)

An operator drives ICAS with `icas-agent` (discover), `icas-play` (replay), and `icas-adapt`. An agent host may invoke the same catalog through `icas-mcp`. There is no co-browsing console, worker queue, or real bank.

Discover and adapt write the `capabilities/` catalog. Replay and MCP read it through `CapabilityResolver` and never glob the tree. `ReplayEngine` receives only the **effective** capability. Every run writes `evidence/` (traces, logs, screenshots). Evidence is not an input to the next run.

Discover is the LLM path: `DiscoveryAgent` → `CandidateProposer` (Mastra) → the configured model (`ICAS_DISCOVERY_LLM_*`; default `openai/gpt-4o`). Search state stays in ICAS, not in Mastra memory. Strict replay has no LLM. `--assist` uses a separate `RepairProposer` and `ICAS_ASSIST_LLM_*`. `.env` is model transport only (`MODEL`, `API_KEY`, optional `BASE_URL` and sampling).

`PlaywrightSurface` is the implemented `Surface`. It opens the synthetic tenants: `icas-bank` (`:4101`), `loki-bank` (`:4102`), `helix-cu` (`:4103`). icas-bank and Loki Bank share Vendor+Product `icas-bank` / `icas-bank`; Loki has label/nav drift. Helix CU is a different vendor/product (share hold).

| Component | Package / app |
|---|---|
| Discover CLI | `apps/icas-agent` |
| Replay CLI | `apps/icas-play` |
| Adapt CLI | `apps/icas-adapt` |
| MCP server | `apps/icas-mcp` |
| Catalog, resolve | `@icas/capability` (`FileSystemCapabilityRegistry`, `CapabilityResolver`) |
| Discover, compile | `@icas/discovery` (`DiscoveryAgent`, `CapabilityCompiler`) |
| Replay | `@icas/replay` (`ReplayEngine`) |
| Policy, redact, HITL, evidence | `@icas/policy`, `@icas/redactor`, `@icas/handoff`, `@icas/evidence` |
| Browser | `@icas/surface`, `@icas/browser` |
| Tenants | `tenants/icas-bank`, `loki-bank`, `helix-cu` |

Prompt policy instructs the model. `PolicyGuard` enforces execute. `Redactor` runs before evidence is persisted. The catalog backend is `FileSystemCapabilityRegistry({ root })` only; REST/DB registries are out of scope.

See [`01-system-overview.md`](01-system-overview.md), [`02-repository-structure.md`](02-repository-structure.md), [`06-multi-tenant-and-adaptation.md`](06-multi-tenant-and-adaptation.md).

---

## 2. Lifecycle

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

`icas-adapt` is a third lifecycle, not a second discover: guarded replay against another tenant, then header-only enrollment or a small declarative patch. See [§3.8](#38-multi-tenant--adapt).

---

## 3. Subsystems

### 3.1 Discovery and compiler

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

### 3.2 Catalog and resolve

Identity is catalog `id` only (for example `loan-payoff`). Vendor+Product is the app family. Tenant identity lives on the override, not on every route in the base.

Callers must not glob `capabilities/`. `@icas/capability` owns schema, validation, CRUD, overrides, and resolve.

```mermaid
flowchart TB
  id["catalog id: loan-payoff"]
  base[("capability.json")]
  icasOv[("overrides/icas-bank.json")]
  lokiOv[("overrides/loki-bank.json")]
  helixOv[("overrides/helix-cu.json")]
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

### 3.3 Replay

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
  http["document HTTP 403/404/5xx"]
  outcomes["possibleOutcomes on this step"]
  generic["runtime generic chrome"]
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

### 3.4 Surface

The artifact speaks semantic actions, targets, assertions, and outputs. `PlaywrightSurface` is the implemented driver. Desktop/accessibility stays a future mapping behind the same seam; this prototype does not implement a second driver.

```mermaid
flowchart TB
  callers["Discovery / Replay / Handoff"]
  seam(Surface)
  pw[PlaywrightSurface]
  browser[["headed browser session"]]
  bank[["icas-bank"]]
  loki[["loki-bank"]]
  helix[["helix-cu"]]
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

Target resolution is ranked: `roleText`, `visibleText`, `label`, then `relative` / `css` / `xpath`. Coordinates are last resort. `roleText` / `visibleText` match a substring of the accessible name so catalog chrome still hits concatenated tiles. Discovery may bind a Playwright snapshot `ref` (`e12`) on the live page for click/fill; that token is not a catalog strategy. Replay uses the model's locator phrases plus optional bind CSS/`label`, never the ref and never the live innerText name. Success outputs are not bound — extract locators stay the model's captions. Bind is best-effort: empty unlabeled inputs still execute via the ref or the model's `relative` locators. Document HTTP status is an optional `Observation.httpStatus` when Playwright observed a main-frame document response. Details: [`10-surface-abstraction.md`](10-surface-abstraction.md).

### 3.5 Safety

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

### 3.6 Handoff

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

### 3.7 Evidence

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

### 3.8 Multi-tenant / adapt

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

### 3.9 MCP (stretch)

`icas-play` is the human CLI. `icas-mcp` is the agent-facing adapter over the **same** registry, resolver, and `ReplayEngine`. Stdio transport for the local demo. One tool per saved capability; typed args from compiled `inputs`. Tenant must already be enrolled (default `icas-bank`).

On `business_outcome`, MCP surfaces `heading` / `summary` / `message` from replay `details` (Pass 6.13). Details: [`11-agent-facing-mcp.md`](11-agent-facing-mcp.md).

---

## 4. Cross-cutting sequences

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

## 5. Package dependency direction

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

## 6. Scope

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
    r2["HTTP + generic chrome"]
    r3["4.15 phrase embeddings — deferred"]
    r4["5.22 screenshot pixels in generate"]
    r5["MCP heading/summary"]
    r6["Phase 8 real run artifacts"]
    r7["REPORT.md"]
  end
```

| Bucket | What | Notes |
|---|---|---|
| Must | Discover → artifact → enroll → replay + errors → HITL → evidence | [`01`](01-system-overview.md), Phases 1–5 and 6.1–6.5 |
| Stretch | `--assist`, `icas-adapt`, MCP, browser takeover | Built in-repo; draw dashed. |
| Out | Co-browsing console, queues, real PII, desktop driver, REST/DB registry, URL inference | Keep the `Surface` and `CapabilityRegistry` seams; do not implement the extras |
| Remaining | vision pixels (5.22), phrase embeddings (4.15, deferred), Phase 8 live-run artifacts | See [`TODO.md`](../TODO.md) |

Synthetic tenants `icas-bank`, `loki-bank`, and `helix-cu` are in (Phase 7). The first concrete capability remains: generate a loan payoff statement for `loanAccountId` + `payoffDate`, extracting `totalPayoffAmount`, `principalBalance`, and `perDiemInterest`. Helix CU is a second product (share hold) so a different `--goal` can be discovered. Discovery must learn each path from the live UI; it must not hard-code it.

Reviewer-facing seven headings stay in [`REPORT.md`](../REPORT.md). Demo commands live in the root README. Testing philosophy: [`12-testing-and-demo.md`](12-testing-and-demo.md).
