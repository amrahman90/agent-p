# Foundation Module Documentation (Phase 1 + 1.5)

## Goal

Establish a stable TypeScript CLI baseline with validated configuration, dependency wiring, and cross-platform SQLite initialization.

## Step-by-step modules

### 1) CLI entry and runtime exports

- `src/cli.ts`
  - defines `runCli()` using `commander`
  - bootstraps DI runtime container at process startup
  - adds `config:check`, `db:check`, `skills:suggest`, `skills:load`, `agents:scout`, `agents:builder`, `agents:tester`, `agents:reviewer`, and `agents:verifier` commands
  - supports verifier trust-input flags (`--test-pass-rate`, `--review-severity`, `--completeness`, `--evidence-quality`)
- `src/index.ts`
  - central export surface for CLI, config, DB, memory, search, and skills

### 2) Configuration module

- `src/config/schema.ts`
  - defines `agentPConfigSchema` with defaults for expertise/search/workflow/memory/hooks/telemetry/agents
- `src/config/load-config.ts`
  - resolves config path
  - parses YAML
  - validates with Zod
  - throws `ConfigValidationError` on schema failure

### 3) DI container module

- `src/core/container.ts`
  - generic token-based registration and resolution
  - supports transient and singleton providers
  - exposes shared token constants via `TOKENS`
- `src/core/bootstrap.ts`
  - composes service registrations for runtime startup
  - loads and validates skills manifest
  - registers `SkillRegistry` and `SkillActivator` singletons
  - registers `SearchEngine`, `MemoryManager`, `ExpertOrchestrator`, `ScoutSubagent`, `BuilderSubagent`, `TesterSubagent`, `ReviewerSubagent`, and `VerifierSubagent` singletons
  - uses token bindings from `TOKENS` (`ExpertOrchestrator`, `ScoutSubagent`, `BuilderSubagent`, `TesterSubagent`, `ReviewerSubagent`, `VerifierSubagent`)

### 4) Cross-platform SQLite module (Phase 1.5)

- `src/db/database-manager.ts`
  - attempts `better-sqlite3` first
  - falls back to `sql.js` if native module is unavailable
  - normalizes `run/get/all/exec/close` through adapter methods
  - ensures database parent directory exists

## Security and correctness choices

- default config fallback if config file is missing.
- explicit driver info reporting for diagnostics (`DriverInfo`).
- initialization guardrails (`DatabaseManager` methods throw when uninitialized).

## Related tests

- `test/unit/config.test.ts`
- `test/unit/container.test.ts`
