# Foundation Module Documentation (Phase 1 + 1.5)

## Goal

Establish a stable TypeScript CLI baseline with validated configuration, dependency wiring, and cross-platform SQLite initialization.

## Step-by-step modules

### 1) CLI entry and runtime exports

- `src/cli/index.ts`
  - defines `createCliProgram()` using `commander`
  - bootstraps DI runtime container at process startup
  - composes modular command groups via factory functions
  - exports `runCli()` as main entry point
- `src/cli/commands/config.ts` - `config:check`, `db:check` commands
- `src/cli/commands/stats.ts` - `stats`, `eval` commands
- `src/cli/commands/debug.ts` - `debug agents|skills|memory|search|tokens|hooks` subcommands
- `src/cli/commands/hooks.ts` - hooks management commands
- `src/cli/commands/skills.ts` - `skills:suggest`, `skills:load` commands
- `src/cli/commands/agents.ts` - `agents:scout`, `agents:builder`, `agents:tester`, `agents:reviewer`, `agents:verifier`, `agents:quality` commands
- `src/cli/parsers.ts` - CLI argument parsers and validators
- `src/cli/helpers.ts` - Shared helper functions
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
  - provides `resolve()` for required dependencies and `resolveOptional()` for optional dependencies
- `src/core/bootstrap.ts`
  - composes service registrations for runtime startup
  - loads and validates skills manifest
  - registers `SkillRegistry` and `SkillActivator` singletons
  - registers `SearchEngine`, `MemoryManager`, `ExpertOrchestrator`, `ScoutSubagent`, `BuilderSubagent`, `TesterSubagent`, `ReviewerSubagent`, and `VerifierSubagent` singletons
  - uses token bindings from `TOKENS` (`ExpertOrchestrator`, `ScoutSubagent`, `BuilderSubagent`, `TesterSubagent`, `ReviewerSubagent`, `VerifierSubagent`)

### 4) Unified error hierarchy

- `src/errors/index.ts`
  - defines `AgentPError` base class with timestamp and cause tracking
  - provides domain-specific error types:
    - `ValidationError` - schema/validation failures with issues array
    - `ConfigurationError` - config loading/validation errors
    - `WorkflowError` - workflow execution errors with workflowId and step
    - `MemoryError` - memory operations with operation context
    - `SearchError` - search operations with query context
    - `DatabaseError` - database operations with operation context
    - `ExecutionError` - stage execution errors with stage context
    - `SkillError` - skill loading/activation errors with skillId
    - `NetworkError` - network operations with URL context
    - `NotFoundError` - resource not found with resource and identifier
  - all errors expose `ErrorCode` enum for programmatic handling

### 5) Cross-platform SQLite module (Phase 1.5)

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
