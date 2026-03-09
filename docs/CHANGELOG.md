# Changelog

## 0.0.2

### Added

- TypeDoc configuration (`typedoc.json`) for API documentation generation.
- `docs:api` script for generating API documentation via TypeDoc.
- `docs/guides/documentation.md` guide explaining documentation generation and JSDoc standards.
- JSDoc documentation with @example tags on priority modules.
- Unified error hierarchy with `AgentPError` base class and 10 domain-specific error types.
- Modular CLI structure in `src/cli/` with separate command modules.
- Container `resolveOptional()` method for optional dependency resolution.
- Path-security unit tests (17 test cases).
- Circuit breaker unit tests (6 test cases).

### Changed

- CLI entry point split from monolithic `src/cli.ts` into modular `src/cli/` structure.
- Documentation updated to reflect modular CLI structure across all architecture docs.
- Container interface now includes `resolveOptional()` method.
- Lint error fixes: removed empty interfaces and unused imports.

### Fixed

- Hardened runtime boundaries by validating D3 workflow checkpoints, context analysis, and phase/artifact compatibility with strict Zod schemas.
- Removed scout cross-scope memory scans by switching to session-scoped lookup contracts (`searchSession`) to preserve memory isolation.
- Updated memory and agents architecture docs to reflect scoped scout retrieval and isolation expectations.
- Updated skills architecture/guide docs with trigger-source precedence (`manifest -> frontmatter -> triggers.json`), manifest-relative trigger-source paths, and sanitization guarantees.

## 0.0.1

- Implemented D3 workflow planning/execution/resume with deterministic phase lineage.
- Added cache-aware runtime reuse, reindex replay controls, and hardened planning artifact index lifecycle.
- Strengthened cache reuse guardrails for partial plan matches and request hint drift.
- Introduced explicit search pipeline `SearchContext` contract via `src/search/pipeline.ts` and routed SearchEngine orchestration through it.
- Added workflow/search hardening tests and kept full verification gate green (`pnpm verify:phase9`).
