# ICAS — Interface Computer-Use Automation System

ICAS is a small end-to-end computer-use automation system built for the Interface.AI engineering take-home. Discovery learns the contract. Replay implements the contract. MCP exposes the contract to other agents.

- `icas-agent` uses an LLM to discover how to complete a goal against a live UI.
- A successful discovery is compiled into a typed capability artifact (catalog `id` only; tenant differences live on overrides). First discover also writes a header-only tenant override (`overrides: {}`) so the discovering tenant is enrolled without copying tenant chrome into the base.
- `icas-play` replays a known capability deterministically, with checkpoints, structured outputs, exceptional-state classification from compiled `possibleOutcomes`, and optional bounded `--assist`.
- `icas-adapt` specializes a known capability for another tenant running the same vendor/product when checkpoints reveal drift. One-step patches only; larger divergence rolls back and requires rediscovery.
- `icas-mcp` exposes saved capabilities as tools that another AI agent can discover and invoke by name with typed arguments. It resolves the same catalog and calls the same `ReplayEngine` as play.

The repository keeps runnable entry points in `apps/`, behavior in `packages/`, and synthetic tenant apps in `tenants/`.

## Repository layout

```text
apps/              Runnable ICAS programs
packages/          Reusable ICAS implementation
tenants/           Synthetic banking tenants (icas-bank, icas-banc, loki-bank, helix-cu)
capabilities/      Generated capability artifacts (do not hand-author)
evidence/          Run traces, replay logs, screenshots, and handoff evidence
demo-recordings/   Demo recordings (numbered 01–14)
docs/              Architecture and design decisions
tests/             Cross-package integration tests
```

## Setup

```bash
pnpm install
cp .env.example .env
# Set ICAS_DISCOVERY_LLM_API_KEY (and ICAS_ASSIST_LLM_API_KEY / ICAS_ADAPT_LLM_API_KEY
# if you use --assist or icas-adapt mismatch patches).
# MODEL is provider/model, default openai/gpt-4o. Leave BASE_URL empty for hosted APIs.
pnpm build
```

Callers must not glob `capabilities/`. CLIs use `FileSystemCapabilityRegistry` (override with `ICAS_CAPABILITIES_ROOT`). Evidence defaults to `./evidence` (`ICAS_EVIDENCE_ROOT`).

## Demo path

Four synthetic **staff** UIs (no login, no real PII). Three of them are the same fictional Vendor+Product (`icas-bank` / `icas-bank`) so ICAS can reuse one payoff capability and still prove tenant drift. Helix is a **different** vendor/product so a second goal is not a loan-payoff clone. Screen recordings of this path are in [`demo-recordings/`](demo-recordings/).

| Tenant | Port | Role |
|---|---|---|
| `icas-bank` | `:4101` | Discover `loan-payoff`. Replay, not-found, wait overlay, MCP default. |
| `icas-banc` | `:4104` | Same product, one rename (Inquire → Look Up). `--assist` on the icas-bank enrollment (no catalog write), then bounded `icas-adapt` success. |
| `loki-bank` | `:4102` | Same product, several label/nav changes. Adapt of `loan-payoff` fails; rediscover as `payoff-statement`. |
| `helix-cu` | `:4103` | Vendor/product `helix` / `helix`. Discover `share-hold` (div layout). Replay with `--assist`. |

`--vendor` / `--product` / `--tenant` are never inferred from `--url`. `--url` only opens this run’s surface (deployment/environment). Replay `--` flags come from `icas-play describe`.

```bash
export ICAS_CAPABILITIES_ROOT=$PWD/capabilities
export ICAS_EVIDENCE_ROOT=$PWD/evidence
```

### 0. Start servers

One tenant per terminal. Leave all four up.

```bash
pnpm icas-bank    # :4101
pnpm loki-bank    # :4102
pnpm helix-cu     # :4103
pnpm icas-banc    # :4104
```

```bash
curl -s -o /dev/null -w 'icas-bank 4101 %{http_code}\n' http://127.0.0.1:4101/
curl -s -o /dev/null -w 'loki-bank 4102 %{http_code}\n' http://127.0.0.1:4102/
curl -s -o /dev/null -w 'helix-cu 4103 %{http_code}\n' http://127.0.0.1:4103/
curl -s -o /dev/null -w 'icas-banc 4104 %{http_code}\n' http://127.0.0.1:4104/
```

### 1. Discover loan-payoff

Required: `--id` (unique), `--url`, `--goal`. Put values to type in the goal. Discover refuses an existing `--id`. Do not pass typed fill flags here.

```bash
pnpm icas-agent \
  discover \
  --id loan-payoff \
  --url http://localhost:4101 \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"

pnpm icas-play list
pnpm icas-play describe loan-payoff
```

### 2. Deterministic replay (no LLM)

Tenant must be enrolled. Use a different loan than discovery.

```bash
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### 3. Business outcome

Unknown loan → `business_outcome` from compiled `possibleOutcomes` (not an engine enum).

```bash
pnpm icas-play \
  run loan-payoff \
  --url http://localhost:4101 \
  --loanAccountNumber 000000 \
  --payoffDate 2026-09-30
```

### 4. Recoverable interstitial

`?inject=wait` on Loan Details. Replay dismisses **Continue**, then finishes. Do not use `?inject=hitl` here.

```bash
pnpm icas-play \
  run loan-payoff \
  --url "http://localhost:4101/?inject=wait" \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### 5. Assist (icas-banc URL, no catalog write)

`--tenant icas-bank` (already enrolled) plus icas-banc’s URL so Inquire misses Look Up. Needs `ICAS_ASSIST_LLM_*`. Repair is this run only; it does not persist an override. Do not use `--tenant icas-banc` here.

```bash
pnpm icas-play \
  run loan-payoff \
  --assist \
  --tenant icas-bank \
  --url http://localhost:4104 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### 6. icas-banc adapt (one-step success)

Same Vendor+Product; Inquire → Look Up. Needs `ICAS_ADAPT_LLM_*`. Re-verify is `ReplayEngine` with no LLM. Step 6 already repaired this miss for one run; this step persists Look Up.

```bash
pnpm icas-adapt \
  loan-payoff \
  --tenant icas-banc \
  --url http://localhost:4104 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### 7. Loki adapt (expected fail)

Several label/nav renames. One-step patch, then re-verify rolls back. `loan-payoff` stays enrolled for icas-bank / icas-banc only.

```bash
pnpm icas-adapt \
  loan-payoff \
  --tenant loki-bank \
  --url http://localhost:4102 \
  --loanAccountNumber 112233 \
  --payoffDate 2026-09-30
```

### 8. Loki rediscover (`payoff-statement`)

New catalog id for the same goal. Pass identity explicitly. Do not reuse `--id loan-payoff`.

```bash
pnpm icas-agent \
  discover \
  --id payoff-statement \
  --url http://localhost:4102 \
  --vendor icas-bank \
  --product icas-bank \
  --tenant loki-bank \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30"

pnpm icas-play describe payoff-statement

pnpm icas-play \
  run payoff-statement \
  --tenant loki-bank \
  --url http://localhost:4102 \
  --loanNumber 112233 \
  --payoffDate 2026-09-30
```

Replay flags after this discover come from that describe (this run: `loanNumber` + `payoffDate`). Omitted `--tenant` defaults to `icas-bank`, which is not enrolled on this id.

### 9. HITL

Requires `payoff-statement` (8.9). `loan-payoff` has no hitl outcomes. Overlay is on the Loki payoff statement; `message=` matches compiled `Authorization required`. Click **human interacted**, then ENTER in the CLI.

```bash
pnpm icas-play \
  run payoff-statement \
  --tenant loki-bank \
  --url "http://localhost:4102/?inject=hitl&message=Authorization%20required" \
  --loanNumber 112233 \
  --payoffDate 2026-09-30
```

HITL is control transfer of the **same** headed browser session (not a co-browsing console).

### 10. Helix CU (`share-hold`)

Different vendor/product and goal. Pass identity explicitly.

```bash
pnpm icas-agent \
  discover \
  --id share-hold \
  --url http://localhost:4103 \
  --vendor helix \
  --product helix \
  --tenant helix-cu \
  --goal "Place a \$250.00 hold on member 441122 share 01 for pending debit card authorization. Extract the hold confirmation number, available balance after the hold, and the hold expiry date."

pnpm icas-play describe share-hold

pnpm icas-play \
  run share-hold \
  --assist \
  --tenant helix-cu \
  --vendor helix \
  --product helix \
  --url http://localhost:4103 \
  --memberNumber 441122 \
  --holdAmount 250.00 \
  --holdReason "pending debit card authorization"
```

Replay flags after this discover come from that describe (this run: `memberNumber`, `holdAmount`, `holdReason`). Omitted `--tenant` / `--vendor` / `--product` default to `icas-bank`, which does not match this artifact. Share `01` is compiled into the clicks, not a flag. `--assist` repairs that share-row click for this run (`ICAS_ASSIST_LLM_*`); it does not persist an override.

### 11. MCP Inspector

Inspector starts the web UI and spawns `pnpm icas-mcp`. Do not also run `pnpm icas-mcp` in another terminal. Do not `tee`. icas-bank must be running. This step is `loan_payoff` only.

```bash
npx -y @modelcontextprotocol/inspector \
  -e ICAS_CAPABILITIES_ROOT=$PWD/capabilities \
  -e ICAS_EVIDENCE_ROOT=$PWD/evidence \
  --cwd $PWD \
  pnpm icas-mcp
```

### 12. MCP in Cursor

Project `.cursor/mcp.json` (so `${workspaceFolder}` works). User-global `~/.cursor/mcp.json` needs absolute paths.

```json
{
  "mcpServers": {
    "icas": {
      "command": "pnpm",
      "args": ["icas-mcp"],
      "cwd": "${workspaceFolder}",
      "env": {
        "ICAS_CAPABILITIES_ROOT": "${workspaceFolder}/capabilities",
        "ICAS_EVIDENCE_ROOT": "${workspaceFolder}/evidence"
      }
    }
  }
}
```

Pass `url` on the tool call (runtime surface; not stored on the capability). Omitted `tenant` / `vendor` / `product` default from that capability. Override `tenant` for icas-banc. Do not call `loan_payoff` with `tenant: loki-bank`. Optional `assist` (default false) uses `ICAS_ASSIST_LLM_*` from repo `.env`; Helix share-row replay needs `assist: true`.

| Ask about | Tool | `tenant` | `vendor` / `product` | `assist` | `url` |
|---|---|---|---|---|---|
| icas-bank payoff | `loan_payoff` | omit | omit | omit | `http://localhost:4101` |
| icas-banc payoff | `loan_payoff` | `icas-banc` | omit | omit | `http://localhost:4104` |
| Loki payoff | `payoff_statement` | omit | omit | omit | `http://localhost:4102` |
| Helix hold | `share_hold` | omit | omit | `true` | `http://localhost:4103` |

```text
How much principal balance on loan 112233 as of 2026-09-30 on tenant icas-bank at http://localhost:4101.
```

```text
Generate a payoff statement for loan 112233 as of 2026-09-30 on tenant icas-banc at http://localhost:4104.
```

```text
Payoff for loan 112233 as of 2026-09-30 on tenant loki-bank at http://localhost:4102. Use payoff-statement, not loan-payoff.
```

```text
Place a $250.00 hold on member 441122 share 01 for pending debit card authorization on tenant helix-cu at http://localhost:4103. Use share_hold with assist true. Return confirmation id, available after hold, and expiry.
```

Known-good icas-bank loans: `987654` (primary), `112233` (second active). Missing ids show `No loan record found`. See `tenants/icas-bank/README.md`.

## Design principles

1. **The model discovers; replay executes.** Discovery learns the contract. Replay implements the contract. MCP exposes the contract to other agents. LLM reasoning is used where the route is unknown. Known capabilities replay without model decisions by default.
2. **A capability is a contract, not a transcript.** The artifact contains typed inputs/outputs, ordered actions, target descriptions, checkpoints, optional `possibleOutcomes`, and overall success rules.
3. **Replay is guarded, not blind.** Happy-path evidence wins first. Exceptional-state classification runs only when the expected next state is absent (next locator missing, or last-step overall `success` miss). Then: document HTTP 403/404 fail, 5xx retry then fail, compiled `possibleOutcomes`, then runtime generic chrome.
4. **Same product does not imply identical tenant UI.** A capability for a vendor/product is a candidate for reuse. Tenant compatibility is an enrolled override resolved by `CapabilityResolver`. `ReplayEngine` never branches on tenant. Adapt stays one-step; substantial divergence rediscovers.
5. **Safety is layered.** Prompt policy influences model proposals; runtime policy gates actual execution; redaction controls what may leave runtime memory or be persisted.
6. **Human handoff means control transfer.** Automation can pause, cede the same live browser session to a human, capture what changed, and resume.
7. **Surface-specific code stays behind an abstraction.** Playwright is the implemented web surface, but capability semantics should not fundamentally depend on the DOM.

See [`docs/README.md`](docs/README.md) for the detailed design notes. Design write-up: [`REPORT.md`](REPORT.md).

## Status

The system implements discover → artifact + tenant enrollment → deterministic replay, exceptional-state classification, HITL, and evidence. Also in-repo: `--assist`, `icas-adapt`, MCP. Deferred: phrase embeddings (4.15) and screenshot pixels on `generate` (5.22).
