# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- TypeDoc configuration (`typedoc.json`) for API documentation generation.
- `docs:api` script for generating API documentation via TypeDoc.
- `docs/guides/documentation.md` guide explaining documentation generation and JSDoc standards.
- JSDoc documentation with @example tags on priority modules (`agents/types.ts`, `agents/expert.ts`, `hooks/types.ts`, `hooks/policy.ts`, `telemetry/types.ts`, `evals/types.ts`, `workflow/executor.ts`).
- JSDoc documentation comments on core modules (`engine.ts`, `container.ts`, `pipeline.ts`, `memory/manager.ts`).
- Unified error hierarchy (`src/errors/index.ts`) with `AgentPError` base class and 10 domain-specific error types (`ValidationError`, `ConfigurationError`, `WorkflowError`, `MemoryError`, `SearchError`, `DatabaseError`, `ExecutionError`, `SkillError`, `NetworkError`, `NotFoundError`).
- Modular CLI structure in `src/cli/` with separate command modules (`commands/config.ts`, `commands/stats.ts`, `commands/debug.ts`, `commands/hooks.ts`, `commands/skills.ts`, `commands/agents.ts`), parsers, and helpers.
- Container `resolveOptional()` method for optional dependency resolution without try/catch workarounds.
- Path-security unit tests (`test/unit/path-security.test.ts`) with 17 test cases covering path traversal, command injection, and symlink attack prevention.
- Circuit breaker unit tests (`test/unit/agents-expert-circuit-breaker.test.ts`) with 6 test cases covering failure threshold, half-open, and recovery states.

- `agents:quality` metadata options `--importance` and `--stability` with deterministic 1..5 handling and policy forwarding.
- Quality contract propagation for importance/stability across gate state and quality summary while preserving `contractVersion: "1.1.0"`.
- New `hooks:session-start <sessionId>` CLI scaffold command for Phase 7 SessionStart hook execution.
- New Phase 7 hook runtimes for `pre_tool_use`, `post_tool_use`, `stop`, and `notification` with strict Zod validation and deterministic execution outputs.
- Claude and OpenCode hook translators at boundary layer (`src/hooks/translators/*`) with OpenCode parity mappings (`session.created`, `tool.execute.before`, `tool.execute.after`, `session.idle`, `tui.toast.show`).
- New hook CLI commands with platform output targeting: `hooks:pre-tool-use`, `hooks:post-tool-use`, `hooks:stop`, `hooks:notification`.
- Central neutral `HookPolicyEngine` with strict-mode controls, risky tool escalation, sensitive-pattern blocking, and default-decision governance.
- Structured hook audit trail (`HookAuditLogger`) with in-memory and JSONL sinks, sensitive-field redaction, and bounded payload/context previews.
- New CLI governance commands: `hooks:config` and `hooks:audit-log`.
- Governance and observability test coverage: `hooks-policy`, `hooks-audit`, and integration parity tests for strict-mode pre/post behavior.
- Hook policy extensibility model with profile presets (`strict`, `balanced`, `permissive`) plus scoped `categoryOverrides` and `toolOverrides`.
- Deterministic policy precedence behavior across overrides (`profile -> categoryOverrides -> toolOverrides`) with explicit matrix coverage.
- Additional permissive-profile sanity coverage to confirm non-risky defaults unless explicitly overridden.
- Runtime default hooks policy profile in `.agent-p/config.yaml` set to `balanced` while preserving legacy `strictMode` compatibility.
- Snapshot contract coverage for governance CLI outputs (`hooks:config`, `hooks:audit-log`) to prevent output drift.
- Dedicated E2E test config `vitest.e2e.config.ts` with Phase 9 lane targeting for both `test/integration/**/*.test.ts` and `test/e2e/**/*.e2e-spec.ts`.
- Shared test bootstrap `test/setup.ts` and helper utility `test/helpers/cli-runner.ts` for real CLI smoke execution.
- Initial high-value governance E2E smoke coverage in `test/e2e/cli-governance-smoke.e2e-spec.ts` for `hooks:config`, `hooks:pre-tool-use`, and `hooks:post-tool-use`.
- New `test:contracts` script for focused CLI contract checks (`test/unit/cli.test.ts`, `test/unit/cli-hooks.test.ts`).
- New `verify:phase9` aggregate gate command for Phase 9 hardening workflow.
- New database driver-selection unit tests covering native path and sql.js fallback path (`test/unit/database-manager.test.ts`).
- Bootstrap guard tests for invalid manifest validation and loader option forwarding (`test/unit/bootstrap.test.ts`).
- Additional branch-hardening tests for migration runner edge paths (missing directory, blank SQL skip, rollback on failed migration).
- Additional ripgrep stage tests covering regex flag args and process/parse failure branches for safer Stage 1 search behavior.
- Additional branch-hardening tests for `sql-safety`, `search` API constructor/sanitization forwarding, and selective CLI command wiring/runtime paths.
- Phase 10 observability primitives: `SessionMetricsTracker` with JSONL telemetry storage (`sessions/`, `metrics/`) and typed event/session-summary schemas.
- Evaluation runtime primitives: `EvaluationEngine` score/grade/recommendation contract and `SelfLearningPatternStore` JSONL pattern sink.
- New diagnostics commands `stats` (session telemetry summary) and `eval` (evaluation scoring from telemetry).
- Post-tool-use runtime forwarding hooks for telemetry recording and self-learning pattern capture.
- New unit coverage for telemetry summaries, evaluation scoring, post-tool-use recorder forwarding, and observability CLI command contracts.
- Automatic `agent_run` telemetry recording at CLI agent execution boundaries (`expert`, subagents, and quality-path stage outputs).
- Cost tracking middleware abstraction with JSONL token/cost events and session aggregation (`debug tokens`).
- Skill effectiveness event store and deterministic aggregation output (`debug skills`).
- Progress-report contract + JSONL pipeline with latest per-agent snapshots exposed in `debug agents`.
- Expanded observability diagnostics via `debug agents`, `debug memory`, `debug search`, `debug tokens`, and `debug hooks`.
- First-class `search_run` telemetry recording for query/provider/runtime/result_count/error observability in session diagnostics.
- New `debug prune` command with per-stream retention controls for token, progress, and skill-effectiveness JSONL telemetry.
- Session-scoped memory query API `MemoryManager.searchSession(term, sessionId, limit?)` for explicit retrieval boundaries.
- Skill loader trigger-source parity with `SKILL.md` frontmatter primary and `triggers.json` fallback hydration when manifest triggers are absent.
- Skill content sanitization hardening across loader/activation paths with focused regression tests for loader, activation, and CLI `skills:suggest`/`skills:load` contracts.

### Changed

- Expanded CLI test coverage for invalid quality metadata inputs (`0`, `6`, non-numeric) to enforce strict parser behavior.
- Hooks architecture docs now document neutral-core plus Claude/OpenCode adapter model and event mapping details.
- Hook runtime classes now delegate decisions through shared neutral policy core and emit audit events with platform-aware metadata.
- Hook config schema now includes `hooks.policy.*` and `hooks.audit.*` with fail-fast validation for contradictory strict-mode settings.
- Documentation trackers aligned to policy-profile defaults, migration semantics, and override precedence test guarantees.
- `test:e2e` now executes via dedicated config (`vitest run --config vitest.e2e.config.ts`) to make Phase 9 structure explicit while preserving integration coverage.
- `verify:phase9` now enforces full Phase 9 gate sequence including `test:coverage`.
- `vitest.config.ts` coverage configuration is restored with `@vitest/coverage-v8` provider and `text`/`html` reporters.
- `typedoc` upgraded to `0.28.17` to align with TypeScript `5.9.x` peer compatibility.
- pnpm install policy now explicitly approves native build dependencies via `onlyBuiltDependencies` (`better-sqlite3`, `esbuild`).
- CI now includes a dedicated hard gate job running `pnpm verify:phase9` on Ubuntu + Node 24.
- Translator unit tests expanded for skipped/default/escalation output branches (`test/unit/hooks-translators.test.ts`).
- Container bootstrap coverage expanded to resolve and validate all registered hook/search/memory singletons (`test/unit/container.test.ts`).
- Testing and architecture docs updated for the latest Phase 9 hardening workflow, including focused regression commands and search engine forwarding behavior.
- Architecture docs now include a dedicated observability module reference and Phase 10 kickoff status (`docs/architecture/observability.md`).
- Phase 10 tracker wording now reflects JSONL-only storage authority for telemetry/evals (`BUILD.md`).
- `debug search` now emits deterministic `recentErrors` ordering (timestamp-ordered, latest 5) for stable contract outputs.
- Scout memory integration now uses session-scoped retrieval (`searchSession`) instead of cross-scope scans, preventing leakage from private/user/shared scopes into scout ranking context.
- Memory and agents architecture docs updated to document scoped scout retrieval and memory isolation guarantees.
- Skills docs now define `triggerSources` path semantics (manifest-relative), deterministic trigger precedence, and loader/activation sanitization behavior.
- CLI entry point split from monolithic `src/cli.ts` into modular `src/cli/` structure with separate command modules, parsers, and helpers.
- Documentation updated to reflect modular CLI structure across all architecture docs (`foundation.md`, `overview.md`, `agents.md`, `hooks.md`, `skills.md`, `workflow.md`).
- Container interface now includes `resolveOptional()` method for cleaner optional dependency handling.
- Lint error fixes: removed empty interfaces in CLI debug commands and unused TelemetrySearchRunEvent import in CLI helpers.
