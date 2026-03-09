# Contributing Guide

## Goal

Define a consistent contributor workflow that preserves contract stability and verification gates.

## Prerequisites

- Node.js `>=24`
- pnpm `10.30.3`

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## Change workflow

1. Implement changes in small, reviewable commits.
2. Keep contracts stable for CLI and workflow payloads unless intentionally versioned.
3. Update trackers/docs when status or architecture changes:
   - `PLAN.md`
   - `BUILD.md`
   - `KNOWLEDGE.md`
   - `docs/architecture/*`

## Required verification before merge

```bash
pnpm verify:phase9
```

## Code standards

- Keep TypeScript strict-safe and avoid implicit `any`.
- Favor deterministic behavior (stable ordering, explicit tie-breakers).
- Add tests for changed behavior, especially around contracts and guards.
- Avoid introducing breaking CLI output changes without contract updates.

## Documentation expectations

- Keep architecture docs aligned with runtime behavior.
- Add or update guide docs for operational workflows.
- Record notable user-facing or contract-impacting updates in `docs/CHANGELOG.md`.
- Generate API documentation when adding new public APIs:
  ```bash
  pnpm docs:api
  ```
- See `docs/guides/documentation.md` for documentation standards.
