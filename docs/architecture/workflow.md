# Workflow Module Documentation (D3 Runtime + Resume + Cache/Reindex)

## Goal

Define and implement the canonical 9-phase D3 workflow with deterministic planning, runtime execution, checkpoint-based resume, and cache/reindex runtime controls.

## D3 phase model

The workflow remains the canonical sequence:

1. understand
2. design
3. plan
4. implement-red
5. build-green
6. refactor
7. review
8. verify
9. deliver

## Current boundary

- Implemented now:
  - concrete planning engine (`src/workflow/engine.ts`) for static/dynamic/quick routing
  - deterministic phase transition guards (`initialState`, `advanceState`)
  - runtime executor (`src/workflow/executor.ts`) for ordered phase dispatch across subagents
  - checkpoint persistence (`src/workflow/checkpoint-store.ts`) with session-based resume
  - CLI planning/execution/resume command `agents:workflow [query]`
  - cache-aware runtime reuse for completed phase artifacts
  - cross-session planning artifact lifecycle reuse (design-stage artifacts only)
  - reindex replay controls from design-stage boundaries
  - CLI controls `--no-cache` and `--reindex`
  - runtime metadata in execution/checkpoint payloads (`cache.hits/misses`, `reindex.requested/applied`)

## Implemented interfaces

- `D3WorkflowPhase`: discriminated 9-phase union.
- `D3WorkflowPlan`: resolved mode, complexity profile, and ordered phase plan.
- `D3WorkflowState`: current/completed/remaining phase state for guarded transitions.
- `D3WorkflowExecutionResult`: per-phase execution output, failures, and resume metadata.
- `D3WorkflowCheckpoint`: persisted runtime state (next phase index, artifacts, context, failures).
- `D3WorkflowRuntimeMetadata`: cache/reindex runtime state persisted in checkpoints and surfaced in execution results.

## Planned interfaces

- `WorkflowTransition`: explicit source/target + condition metadata.

## Integration boundaries

- Agents module provides phase execution units.
- Quality module provides trust/goal gate decisions.
- Memory module stores phase artifacts and summaries.
- Search module supports scout and verification phases.

## Validation approach

- Enforce exhaustive transitions with union-based phase typing.
- Keep phase outputs typed to avoid weakly-typed artifact passing.
- Validate transition preconditions before each state move.
- Resume from checkpointed `nextPhaseOrder` and skip already completed phases deterministically.
- Reuse cached completed phases in-order without changing phase order; mark provenance per phase (`source`).
- For cross-session cache reuse, only design-stage artifacts (`understand`, `design`, `plan`) are reused; develop/deliver phases execute in-session.
- Cross-session planning index management is hardened with stale-entry cleanup, corruption-safe fallback, and bounded retention.
- Cache reuse requires full plan identity parity (mode/analysis/complexity/phase shape/skipped phases) and rejects reuse when requested file/domain hints drift from checkpoint context.
- Apply reindex from first design-stage phase, replaying all downstream phases with deterministic lineage continuity.
