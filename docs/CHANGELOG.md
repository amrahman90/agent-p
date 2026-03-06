# Changelog

## 0.0.2

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
