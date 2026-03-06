# agent-p

Multi-Agent Orchestration & Context Engineering toolkit with a custom Agentic workflow for AI related tasks, implemented in TypeScript for Claude and Opencode.

> **Note:** This package is experimental and intend to use for local-offline project-based focus in future.

`agent-p` provides a CLI runtime with:

- multi-agent orchestration (`expert`, `scout`, `builder`, `tester`, `reviewer`, `verifier`)
- deterministic quality-path execution and policy gates
- skill loading and activation with manifest + trigger-source support
- local memory/search infrastructure and telemetry/evaluation diagnostics

Current project version: `0.0.1`

## Requirements

- Node.js `>=24`
- pnpm `10.30.3` (enforced via `only-allow pnpm`)

## Quick Start

```bash
pnpm install
pnpm build
node bin/cli.js --help
```

Run a few common commands:

```bash
node bin/cli.js config:check
node bin/cli.js skills:suggest "typescript auth hardening" --agent reviewer
node bin/cli.js agents:quality "review this endpoint" --agent expert
```

## CLI Surface (high-value commands)

- `config:check` - validate runtime config
- `db:check` - verify database connectivity/setup
- `skills:suggest <query>` - suggest skills for a task
- `skills:load <skillId>` - load a skill with permission checks
- `agents:scout|builder|tester|reviewer|verifier <query>` - run a specific subagent
- `agents:quality <query>` - execute quality path with trust/goal controls
- `agents:workflow [query]` - run D3 workflow planning/execution path
- `debug ...` (`agents`, `memory`, `search`, `skills`, `tokens`, `hooks`) - diagnostics and observability

Use `node bin/cli.js <command> --help` for full options.

## Development

Primary scripts:

- `pnpm lint` - ESLint checks for `src/` and `test/`
- `pnpm typecheck` - TypeScript no-emit checks
- `pnpm test` - unit/integration tests
- `pnpm test:e2e` - E2E lane (`vitest.e2e.config.ts`)
- `pnpm test:coverage` - coverage run
- `pnpm docs:check` - documentation consistency checks
- `pnpm build` - lint + docs check + compile + asset copy
- `pnpm verify:phase9` - full hard gate sequence

Recommended validation before PR:

```bash
pnpm verify:phase9
```

## Project Info in short

Key paths:

- `src/` - runtime source (CLI, agents, skills, memory, search, hooks, telemetry)
- `test/` - unit/integration/e2e tests
- `bin/` - executable wrappers and build utility scripts
- `migrations/` - database migrations (committed as source-of-truth)
- `.agent-p/` - local runtime state and telemetry artifacts


## Notes

- `migrations/` is intentionally tracked in git; do not add it to `.gitignore`.
- If this package is published to npm later, prefer a `files` allowlist in `package.json` over `.npmignore`.
