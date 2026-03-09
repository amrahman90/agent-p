# Testing Guide (Phase 9 Complete)

## Goal

Document and enforce the finalized Phase 9 testing contract.

## Baseline context (synced)

- `PLAN.md`: Phase 9 is the testing hardening phase.
- `KNOWLEDGE.md` Z12: test pyramid, structure, and command contract.
- `BUILD.md`: Phase 9 completion and verification results are tracked.

## Current command contract

```bash
pnpm test
pnpm test:e2e
pnpm test:contracts
pnpm test:coverage
pnpm verify:phase9
```

- `pnpm test` runs unit + integration tests (`vitest run`).
- `pnpm test:e2e` runs integration + e2e lanes through dedicated config (`vitest run --config vitest.e2e.config.ts`).
- `pnpm test:contracts` runs CLI contract snapshot/shape tests (`test/unit/cli.test.ts`, `test/unit/cli-hooks.test.ts`).
- `pnpm verify:phase9` runs the Phase 9 aggregate gate including coverage.

## Directory target for Phase 9

Current:

```text
test/
├── unit/
├── integration/
├── e2e/
├── helpers/
└── setup.ts
```

Planned expansion:

```text
test/
├── unit/
├── integration/
├── e2e/
├── setup.ts
└── helpers/
```

## Phase 9 implementation checklist

- Define and add dedicated E2E config and `test/e2e/` conventions.
- Introduce shared test setup and helper utilities used across modules.
- Expand module-boundary coverage where contracts are still thin.
- Add security-oriented negative test matrix for risky command/policy paths.
- Keep CLI snapshots deterministic and unchanged unless intentionally versioned.

## Coverage gate status

- `pnpm test:coverage` is an active blocking gate in Phase 9.
- Coverage provider dependency is `@vitest/coverage-v8`.
- Keep coverage enforcement in `pnpm verify:phase9` for CI and local verification parity.
- Recent branch-hardening focus areas now include:
  - `src/db/sql-safety.ts` negative-path guards (empty SQL, null bytes, placeholder binding invariants, template misuse)
  - `src/search/api.ts` constructor/sanitization option forwarding when default stage wiring is used
  - selective CLI skill/runtime branches in `src/cli/index.ts` (`skills:suggest`, `skills:load`, and `runCli` bootstrap path)
  - observability baseline contracts in `src/telemetry/*`, `src/evals/*`, and `src/hooks/post-tool-use.ts` recorder forwarding
  - path-security validation in `test/unit/path-security.test.ts` (17 tests for path traversal, injection, and symlink attacks)
  - circuit breaker resilience in `test/unit/agents-expert-circuit-breaker.test.ts` (6 tests for failure threshold, half-open, and recovery states)

## Focused hardening command set

```bash
pnpm exec vitest run test/unit/sql-safety.test.ts test/unit/search-api-constructor.test.ts test/unit/cli.test.ts
```

- Use the focused command above for quick regression checks while iterating on SQL safety/search API/CLI wiring.
- Always finish with `pnpm verify:phase9` to preserve full-gate parity.

## Security and resilience test sets

```bash
pnpm exec vitest run test/unit/path-security.test.ts
pnpm exec vitest run test/unit/agents-expert-circuit-breaker.test.ts
```

- `test/unit/path-security.test.ts` - 17 tests covering path traversal, command injection, and symlink attack prevention
- `test/unit/agents-expert-circuit-breaker.test.ts` - 6 tests covering circuit breaker states (closed, half-open, open), failure threshold, and recovery behavior

## Phase 10 focused observability checks

```bash
pnpm exec vitest run test/unit/telemetry-session-metrics.test.ts test/unit/telemetry-cost-middleware.test.ts test/unit/evals-progress-report.test.ts test/unit/evals-skill-effectiveness.test.ts test/unit/search-api-constructor.test.ts test/unit/cli-debug-observability.test.ts test/e2e/cli-debug-observability.e2e-spec.ts
```

- The focused Phase 10 lane now verifies:
  - first-class `search_run` telemetry events (`query`, `provider`, `durationMs`, `result_count`, `errors`)
  - deterministic output shapes for `debug agents|skills|memory|search|tokens|hooks`
  - `debug search` error samples in `recentErrors` are timestamp-ordered and capped to the latest 5 failures
  - tie-break stability for identical timestamps in `debug search` uses deterministic ordering (`query`, then `provider`, then `error`)
  - retention/pruning behavior for JSONL streams in `tokens/`, `progress/`, and `evals/skills/`

## Exit criteria

- Phase 9 checklist in `BUILD.md` is complete.
- Documentation stays synchronized with executed test contract.
- Full verification gate remains green after testing changes:

```bash
pnpm verify:phase9
```
