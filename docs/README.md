# Documentation

This directory contains architecture and module docs aligned to implemented project phases.

## Architecture index

- `architecture/overview.md` - phase timeline, implemented boundaries, and module map.
- `architecture/foundation.md` - foundation and cross-platform runtime setup.
- `architecture/memory.md` - memory contracts, stores, and manager behavior.
- `architecture/search.md` - search sanitization, ripgrep stage, ranking, and orchestration.
- `architecture/skills.md` - skills manifest, validation, activation, and CLI flow.
- `architecture/agents.md` - agent contracts, orchestration, quality path, and CLI surface.
- `architecture/workflow.md` - workflow progression and execution semantics.
- `architecture/quality.md` - quality policy, trust gates, and resilience controls.
- `architecture/hooks.md` - hooks runtime, policy profiles/overrides, audit logging, and translators.
- `architecture/observability.md` - JSONL telemetry/evals architecture, search/agent/skill metrics, retention, `debug prune` command reference/examples, and CLI diagnostics.

## Module deep dive

- `search-module.md` - Stage 1 search deep dive (ripgrep + sanitization).

## Guides

- `guides/testing.md` - Phase 9 gate + Phase 10 observability snapshot/retention test coverage.
- `guides/contributing.md` - contribution workflow and verification requirements.
- `guides/skills.md` - skill catalog and activation maintenance guide.
- `guides/workflow.md` - D3 workflow planning/execution/resume operations.

## Changelog

- `CHANGELOG.md` - versioned project changes.

## Root trackers

- `PLAN.md` - implementation plan and sequencing.
- `BUILD.md` - execution log and completed checkpoints.
- `KNOWLEDGE.md` - stable project memory and carry-forward context.
