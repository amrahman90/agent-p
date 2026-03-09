# Workflow Guide

## Goal

Provide an operator-focused guide for running the D3 workflow planner, executor, resume, and cache controls.

## Core command

```bash
pnpm exec tsx src/cli/index.ts agents:workflow "your task"
```

## Planning vs execution

- Planning-only mode returns a workflow plan and does not execute subagents.
- Execution mode runs D3 phases with checkpoint persistence and lineage metadata.
- Resume mode continues from persisted checkpoint state without re-running completed phases.

## Common flags

```bash
pnpm exec tsx src/cli/index.ts agents:workflow "task" --execute
pnpm exec tsx src/cli/index.ts agents:workflow --resume --session <session-id>
pnpm exec tsx src/cli/index.ts agents:workflow "task" --execute --no-cache
pnpm exec tsx src/cli/index.ts agents:workflow "task" --execute --reindex
```

## Runtime expectations

- Execution/resume payloads use `contractVersion: 1.1.0`.
- Planning payload remains on its planning contract version.
- Cache reuse requires strict plan identity parity (phase shape, complexity, skipped phases, mode/analysis settings).
- Requested file/domain hints must be covered by checkpoint context; drift prevents reuse.

## Failure handling

- Use `--resume --session <id>` after interrupted runs.
- Use `--reindex` to replay from design-stage boundaries when planning artifacts need refresh.
- Use `--no-cache` for fully fresh runtime execution.

## Verification

```bash
pnpm exec vitest run test/unit/workflow-engine.test.ts test/unit/workflow-executor.test.ts test/unit/workflow-checkpoint-store.test.ts test/integration/agents-workflow.integration.test.ts
pnpm verify:phase9
```
