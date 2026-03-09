# Architecture Overview (Phase 1 -> 9 Testing Hardened, Phase 10 Kickoff)

## Current implementation boundary

- Completed: Phase 1 (Foundation), Phase 1.5 (Cross-platform SQLite), Phase 2 (Memory core), Phase 3 (Ripgrep + BM25 + orchestration), and Phase 4 (Skills system vertical slice).
- Completed: Phase 6 hardening (runtime quality execution integrated; safety and resilience controls active).
- Deferred by design: Tree-sitter Stage 2, Jaccard Stage 4, and 40-skill expansion.
- Pending major modules: Phase 8B skill-catalog expansion and D3 workflow integration.
- Completed: Phase 7 hooks runtime with platform-neutral contracts and Claude/OpenCode boundary translators.
- Completed: Phase 8A hooks governance baseline and extensibility (policy profiles, scoped overrides, audit trail, migration hardening).

Convention note: A/B suffix is used when a roadmap phase number is split into independent tracks.

## Step-by-step timeline

### Step 1 - Foundation baseline (Phase 1)

- Created TypeScript runtime baseline (`package.json`, `tsconfig.json`, `src/index.ts`, `src/cli/index.ts`).
- Added configuration schema + loader with Zod and YAML (`src/config/schema.ts`, `src/config/load-config.ts`).
- Added DI container for service registration and resolution (`src/core/container.ts`).
- Added initial CLI commands:
  - `config:check` for validated config rendering.
  - `db:check` for SQLite driver detection.

### Step 2 - SQLite portability hardening (Phase 1.5)

- Added `DatabaseManager` with runtime driver selection:
  - primary: `better-sqlite3`
  - fallback: `sql.js`
- Added filesystem safety for DB path creation and fallback persistence (`src/db/database-manager.ts`).

### Step 3 - Database safety and migrations

- Added SQL statement guardrails (`src/db/sql-safety.ts`):
  - single-statement enforcement
  - parameter count matching
  - comment/null-byte rejection
- Added migration execution with checksum validation and transaction boundaries (`src/db/migration-runner.ts`, `src/db/migrate.ts`).

### Step 4 - Memory module implementation (Phase 2)

- Added memory schema contract (`src/memory/schema.ts`, `src/memory/types.ts`).
- Implemented hot tier cache with LRU + TTL (`src/memory/tiered/hot.ts`).
- Implemented SQLite warm store with FTS5 path and LIKE fallback (`src/memory/store.ts`).
- Implemented scope abstractions (`src/memory/scopes/*.ts`) and aggregate API (`src/memory/manager.ts`).

### Step 5 - Search module implementation (Phase 3 scope)

- Added search request/response types (`src/search/types.ts`).
- Added search sanitization and workspace root confinement (`src/search/sanitize.ts`).
- Added Ripgrep Stage 1 executor with JSON parsing and safe arg-array execution (`src/search/ripgrep.ts`).
- Added BM25 ranking implementation (`src/search/bm25.ts`).
- Added orchestration API (`src/search/api.ts`) and package exports (`src/search/index.ts`, `src/index.ts`).

### Step 6 - Skills system vertical slice (Phase 4)

- Added manifest schema and source-of-truth metadata (`src/skills/schema.ts`, `src/skills/skills.json`).
- Added manifest loader with source/dist fallback resolution (`src/skills/loader.ts`).
- Added semantic validation (`src/skills/validator.ts`) for duplicate IDs/triggers and trigger sanitization.
- Added registry, suggestion engine, and manual loading APIs (`src/skills/registry.ts`, `src/skills/activation.ts`).
- Added DI bootstrap for skills services (`src/core/bootstrap.ts`) and integrated bootstrap into CLI runtime.
- Added skills CLI commands:
  - `skills:suggest <query>`
  - `skills:load <skillId>`

### Step 7 - Agents vertical slice expansion (Phase 5)

- Added stricter handoff schemas and runtime payload validation constraints (`src/agents/types.ts`).
- Added deterministic scout ranking with confidence/reason output (`src/agents/scout.ts`).
- Added builder/tester/reviewer/verifier scaffold subagents and expert handoff paths (`src/agents/builder.ts`, `src/agents/tester.ts`, `src/agents/reviewer.ts`, `src/agents/verifier.ts`, `src/agents/expert.ts`).
- Added lifecycle metadata to handoffs (`handoffId`, optional `parentHandoffId`, `attempt`) with schema validation and deterministic ID generation.
- Expanded CLI command surface with `agents:builder <query>`, `agents:tester <query>`, `agents:reviewer <query>`, and `agents:verifier <query>`, plus verifier trust-input flags (`src/cli/index.ts`).
- Added deterministic multi-hop workflow integration coverage (`expert -> scout -> builder -> tester`) with parent-child linkage assertions (`test/integration/agents-workflow.integration.test.ts`).

### Step 8 - Quality runtime and safety layer (Phase 6)

- Added `executeQualityPath(...)` runtime orchestration with trust/goal gates and deterministic stage order (`src/agents/expert.ts`).
- Added resilience controls for quality execution (stage timeout, retry budget, fail-open/fail-closed flags, circuit breaker) (`src/agents/expert.ts`, `src/agents/types.ts`).
- Added dangerous-pattern detection utilities and integration into reviewer/verifier gate behavior (`src/agents/dangerous-patterns.ts`, `src/agents/reviewer.ts`, `src/agents/verifier.ts`).
- Added versioned `agents:quality <query>` contract payload with `contractVersion`, policy, and `qualitySummary` (`src/cli/index.ts`).
- Expanded verifier trust input model with weighted evidence and backward-compatible adapters (`src/agents/verifier.ts`, `src/cli/index.ts`).
- Added snapshot matrix and integration coverage for all-pass, trust-skip, goal-skip, continue-on-failure, stage-disabled, and fail-open/fail-closed scenarios (`test/unit/cli.test.ts`, `test/integration/agents-workflow.integration.test.ts`, `test/unit/agents-contracts.test.ts`).

### Step 9 - Hooks runtime + platform translators (Phase 7)

- Added neutral hook contracts and deterministic runtimes for `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, and `Notification` (`src/hooks/types.ts`, `src/hooks/*.ts`).
- Added boundary translators for Claude and OpenCode event payloads/output envelopes (`src/hooks/translators/claude.ts`, `src/hooks/translators/opencode.ts`).
- Added OpenCode parity event mappings for Phase 7 (`session.created`, `tool.execute.before`, `tool.execute.after`, `session.idle`, `tui.toast.show`).
- Expanded CLI with hook command surface and `--platform neutral|claude|opencode` output targeting (`src/cli/index.ts`).

### Step 10 - Hooks governance + observability + policy extensibility (Phase 8A)

- Added central `HookPolicyEngine` so pre/post/stop/notification governance decisions are applied in the neutral core (`src/hooks/policy.ts`).
- Added profile-based governance model (`strict`, `balanced`, `permissive`) with scoped `categoryOverrides` and `toolOverrides` in policy evaluation (`src/hooks/policy.ts`).
- Added deterministic override precedence behavior (`profile -> categoryOverrides -> toolOverrides`) and matrix coverage for conflict scenarios (`test/unit/hooks-policy.test.ts`).
- Added structured audit trail with redaction and rolling in-memory sink (`src/hooks/audit.ts`).
- Added hooks config hardening for policy/audit settings and contradictory-setting validation (`src/config/schema.ts`).
- Added backward-compatible strict-mode/profile migration behavior and aligned default config profile (`balanced`) (`src/config/load-config.ts`, `.agent-p/config.yaml`).
- Added CLI governance utilities: `hooks:config` and `hooks:audit-log` (`src/cli/index.ts`).
- Added governance-focused unit/integration coverage and CLI snapshot contracts (`test/unit/hooks-policy.test.ts`, `test/unit/hooks-audit.test.ts`, `test/unit/cli-hooks.test.ts`, `test/integration/hooks-governance.integration.test.ts`).

### Step 11 - Skill catalog expansion track (Phase 8B, pending)

- Expand from current vertical-slice skill baseline to full 40-skill catalog coverage.
- Add trigger and permission hardening for larger catalog scope.
- Keep activation behavior deterministic while expanding surface area.

### Step 12 - Evaluation and observability kickoff (Phase 10)

- Added telemetry event schemas and JSONL persistence tracker (`src/telemetry/types.ts`, `src/telemetry/session-metrics.ts`).
- Added evaluation engine and scoring contracts (`src/evals/engine.ts`, `src/evals/types.ts`).
- Added self-learning pattern sink for post-tool-use outcomes (`src/evals/self-learning.ts`).
- Wired post-tool-use runtime to optional telemetry/self-learning recorders (`src/hooks/post-tool-use.ts`).
- Added CLI commands `stats` and `eval` for diagnostics and scoring (`src/cli/index.ts`).

## Module map (implemented)

- Foundation: `src/cli/index.ts`, `src/index.ts`, `src/config/*`, `src/core/*`
- DB: `src/db/database-manager.ts`, `src/db/sql-safety.ts`, `src/db/migration-runner.ts`, `src/db/migrate.ts`
- Memory: `src/memory/*`
- Search: `src/search/types.ts`, `src/search/sanitize.ts`, `src/search/ripgrep.ts`, `src/search/bm25.ts`, `src/search/api.ts`, `src/search/index.ts`
- Skills: `src/skills/schema.ts`, `src/skills/loader.ts`, `src/skills/validator.ts`, `src/skills/registry.ts`, `src/skills/activation.ts`, `src/skills/skills.json`
- Agents: `src/agents/types.ts`, `src/agents/expert.ts`, `src/agents/scout.ts`, `src/agents/builder.ts`, `src/agents/tester.ts`, `src/agents/reviewer.ts`, `src/agents/verifier.ts`
- Hooks: `src/hooks/types.ts`, `src/hooks/session-start.ts`, `src/hooks/pre-tool-use.ts`, `src/hooks/post-tool-use.ts`, `src/hooks/stop.ts`, `src/hooks/notification.ts`, `src/hooks/translators/*`
- Telemetry: `src/telemetry/types.ts`, `src/telemetry/session-metrics.ts`, `src/telemetry/index.ts`
- Evals: `src/evals/types.ts`, `src/evals/engine.ts`, `src/evals/self-learning.ts`, `src/evals/index.ts`

## Skills used by phase (from BUILD mapping)

- Phase 1: `typescript-expert`, `typescript-best-practices`
- Phase 2: `drizzle-orm-patterns`, `typescript-expert`
- Phase 3: `typescript-best-practices`, `modern-javascript-patterns`
- Phase 4: `clean-architecture`, `typescript-advanced-types`

## Next implementation checkpoint

- Phase 9 testing hardening baseline is established and enforced (`vitest.e2e.config.ts`, `test/e2e/`, `test/helpers/`, `test/setup.ts`).
- `pnpm verify:phase9` is now a full blocking gate including `pnpm test:coverage` with `@vitest/coverage-v8`.
- Additional negative-path hardening completed for lower-branch hotspots in `src/db/sql-safety.ts`, `src/search/api.ts`, and selective CLI branches in `src/cli/index.ts`.
- Phase 10 observability baseline is now available via `stats`/`eval` commands and JSONL telemetry storage.
- Continue extending E2E and negative-path coverage while adding agent/skill runtime telemetry integration.
