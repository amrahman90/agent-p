# Agents Module Documentation (Phase 5 + Phase 6 Runtime)

## Goal

Implement expert-driven agent orchestration with typed handoff contracts, lifecycle metadata, runtime DI composition, and CLI entrypoints for all scaffolded subagents.

## Current scope

- Implemented now:
  - shared agent message and handoff payload contracts + runtime validation
  - hardened handoff schemas (session/query/path/domain constraints and bounded analysis fields)
  - lifecycle metadata in handoffs (`handoffId`, optional `parentHandoffId`, `attempt`)
  - deterministic handoff ID generation in `expert` orchestrator
  - `expert` handoff creation APIs for scout, builder, tester, reviewer, and verifier
  - quality-path composition + execution APIs for tester/reviewer/verifier sequencing
  - centralized quality execution policy defaults and skip-reason mapping
  - normalized importance/stability metadata across quality policy, gate state, and summary
  - dangerous-pattern detection and reason-code propagation in reviewer/verifier stages
  - stage timeout/retry/circuit-breaker/rate-limit controls in quality execution
  - `scout` subagent context discovery with deterministic confidence ranking
  - `builder` subagent scaffold planning API
  - `tester`, `reviewer`, `verifier` scaffold APIs
  - CLI commands `agents:scout <query>`, `agents:builder <query>`, `agents:tester <query>`, `agents:reviewer <query>`, `agents:verifier <query>`, and `agents:quality <query>` with structured JSON output
  - golden snapshot tests for all agent CLI command outputs
- Deferred by design:
  - adaptive remediation loops and dynamic backoff policies
  - full D3 workflow execution state machine

## Module boundaries

### 1) Shared contracts

- `src/agents/types.ts`
  - canonical role identifiers (`expert`, `scout`, `builder`, `tester`, `reviewer`, `verifier`)
  - handoff payload structure (`from`, `to`, `sessionId`, `handoffId`, optional `parentHandoffId`, `attempt`, `query`, `analysis`)
  - metadata shape (`reason`, `priority`, `timestamp`)
  - typed request/response envelopes for scout analysis, builder planning, tester planning, reviewer assessment, verifier assessment, and expert planning
  - verifier trust input schema (`testPassRate`, `reviewSeverity`, `completeness`, `evidenceQuality`)
  - quality-path composition policy (`ExpertQualityCompositionPolicy`) for orchestrator planning
  - minimal service contracts (`ScoutSearchService`, `ScoutMemoryService`) for decoupled integration

### 2) Expert orchestrator scaffold

- `src/agents/expert.ts`
  - owns task-level intent (`query`, `sessionId`, optional files/domains)
  - emits deterministic handoff payloads to scout, builder, tester, reviewer, and verifier
  - composes deterministic quality paths (`composeQualityPath`) with optional policy filtering
  - executes quality paths (`executeQualityPath`) with trust/goal gate checks, skip/continue control, timeout/retry behavior, and circuit-breaker handling
  - propagates normalized `importance`/`stability` values in gate states and quality summary
  - centralizes quality policy defaults via `DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY`
  - centralizes skip-reason mapping via `QUALITY_GATE_SKIP_REASON_MAP`
  - normalizes file/domain hints and metadata defaults
  - generates deterministic IDs (`h-{role}-{digest}`) from stable inputs

### 3) Scout subagent with deterministic ranking

- `src/agents/scout.ts`
  - accepts validated scout handoff payload
  - queries `SearchEngine` for ranked hits
  - merges optional session-scoped memory context via `MemoryManager.searchSession()`
  - computes per-file confidence and reasons (`matched terms`, `memory hit`, `domain overlap`)
  - applies deterministic top-N ranking and tie-breakers
  - returns structured analysis envelope with:
    - relevant files
    - ranked files with confidence and reasons
    - detected/inferred domains
    - notes and risk flags

### 4) Builder scaffold subagent

- `src/agents/builder.ts`
  - accepts validated builder handoff payload
  - returns scaffolded plan output (`summary`, `plannedChanges`, `risks`)
  - intentionally does not mutate files in current phase

### 5) Tester scaffold subagent

- `src/agents/tester.ts`
  - accepts validated tester handoff payload
  - returns deterministic test-plan output (`summary`, `commands`, `expectedChecks`, `failureHandling`)
  - intentionally does not execute commands in current phase

### 6) Reviewer scaffold subagent

- `src/agents/reviewer.ts`
  - accepts validated reviewer handoff payload
  - returns deterministic review output (`summary`, `findings[]` with `severity`, `finding`, `recommendedFix`)
  - annotates dangerous findings with deterministic `reasonCode`
  - intentionally does not inspect git diffs in current phase

### 7) Verifier scaffold subagent

- `src/agents/verifier.ts`
  - accepts validated verifier handoff payload and optional trust input
  - parses trust input through `verifierTrustInputSchema`
  - returns deterministic gate output (`summary`, `trustScore`, `threshold`, `gateDecision`, `checks`, `blockers`, `reasonCodes`)

### 8) Runtime composition and CLI integration

- `src/core/bootstrap.ts`
  - registers `SearchEngine`, `MemoryManager`, `ExpertOrchestrator`, `ScoutSubagent`, `BuilderSubagent`, `TesterSubagent`, `ReviewerSubagent`, and `VerifierSubagent` as singletons
- `src/cli/index.ts`
  - adds all subagent commands (`agents:scout`, `agents:builder`, `agents:tester`, `agents:reviewer`, `agents:verifier`, `agents:quality`)
  - supports verifier trust flags (`--test-pass-rate`, `--review-severity`, `--completeness`, `--evidence-quality`, `--coverage`, `--reproducibility`)
  - quality command supports stage toggles, gate thresholds, metadata controls, and resilience controls (`--skip-*`, `--importance`, `--stability`, `--min-*`, `--continue-on-*-failure`, `--stage-timeout-ms`, `--max-stage-retries`, `--circuit-breaker-failure-threshold`, `--rate-limit-max-executions`, `--rate-limit-window-ms`, `--continue-on-rate-limit`)
  - validates handoff via `validateAgentHandoffPayload` before subagent execution
  - prints structured JSON payloads (`{ handoff, analysis }`, `{ handoff, plan }`, `{ handoff, assessment }`, `{ contractVersion, policy, result }`)

## Planned handoff flow

1. `expert` receives user intent and creates run/session metadata.
2. `expert` creates a typed handoff payload for target subagent and attaches lifecycle fields (`handoffId`, optional `parentHandoffId`, `attempt`).
3. payload is validated by Zod before subagent execution.
4. subagent returns deterministic scaffold output for its stage (`analysis`, `plan`, or `assessment`).
5. downstream handoffs can link lineage via `parentHandoffId`.
6. quality-stage chains can be planned through `composeQualityPath(...)` and executed through `executeQualityPath(...)` with deterministic ordering and gate evaluation.

## Validation and testing contract

- Unit tests in `test/unit/agents-contracts.test.ts` and `test/unit/cli.test.ts` focus on:
  - payload shape stability
  - role and priority constraints
  - handoff creation determinism and lifecycle metadata validation
  - negative validation for malformed `handoffId`, `parentHandoffId`, and `attempt`
  - search/memory-backed scout analysis behavior and stable sort guarantees
  - quality-path composition + execution behavior (default chain, policy filtering, gate skip/continue, resilience fail-open/fail-closed)
  - CLI option parsing and output contract for all subagent commands including `agents:quality` contract-version payload
  - golden snapshots for all agent CLI command outputs
- Integration tests in `test/integration/agents-workflow.integration.test.ts` and `test/unit/agents-scout-integration.test.ts` validate:
  - end-to-end CLI -> handoff validation -> subagent execution paths
  - deterministic multi-hop baseline (`expert -> scout -> builder -> tester`) with parent-child handoff linkage
  - CLI quality execution semantics (skip/continue under trust gate and stage-failure fail-open/fail-closed)
  - stable output JSON contracts for scaffold workflows

## Security and correctness choices

- Explicit typed payloads avoid implicit `any` handoff structures.
- Priority and role unions constrain invalid routing targets at compile time.
- Timestamp and session identifiers are required for traceability.
- Handoff lifecycle fields enforce lineage and bounded retry semantics.
- Scout memory lookups are session-scoped to avoid cross-scope/private data leakage into ranking signals.
