# Observability Architecture (Phase 10)

## Goal

Provide deterministic evaluation and observability primitives that can be used by hooks, agents, and CLI diagnostics.

## Implemented scope

- Session telemetry tracker with JSONL persistence (`src/telemetry/session-metrics.ts`).
- Cost tracking middleware with token/cost event persistence (`src/telemetry/cost-middleware.ts`).
- Telemetry event contracts for `post_tool_use`, `agent_run`, and `search_run` (`src/telemetry/types.ts`).
- Post-tool-use runtime forwarding to telemetry recorder and self-learning recorder (`src/hooks/post-tool-use.ts`).
- Self-learning pattern storage to daily JSONL files (`src/evals/self-learning.ts`).
- Skill effectiveness tracking and aggregation (`src/evals/skill-effectiveness.ts`).
- Progress-report contract and JSONL pipeline (`src/evals/progress-report.ts`).
- Evaluation engine for score/grade/recommendation output (`src/evals/engine.ts`).
- New CLI diagnostics commands:
  - `agent-p stats --session <id>`
  - `agent-p eval --session <id>`
  - `agent-p debug agents --session <id>`
  - `agent-p debug skills`
  - `agent-p debug memory`
  - `agent-p debug search --session <id>`
  - `agent-p debug tokens --session <id>`
  - `agent-p debug hooks`
  - `agent-p debug prune --tokens-max-age-days <n> --progress-max-age-days <n> --skills-max-age-days <n>`

## Storage layout

```text
.agent-p/
└── telemetry/
    ├── sessions/{sessionId}.jsonl
    ├── metrics/{yyyy-mm-dd}.jsonl
    ├── progress/{sessionId}.jsonl
    ├── tokens/sessions/{sessionId}.jsonl
    ├── tokens/daily/{yyyy-mm-dd}.jsonl
    └── patterns/{yyyy-mm-dd}.jsonl

.agent-p/
└── evals/
    └── skills/{skillName}.jsonl
```

- `sessions/*.jsonl`: raw per-session telemetry events.
- `metrics/*.jsonl`: daily event append stream for aggregate/offline analysis.
- `tokens/sessions/*.jsonl`: per-session token and cost events from middleware.
- `tokens/daily/*.jsonl`: daily token/cost event stream for budgeting analysis.
- `progress/*.jsonl`: per-session `ProgressReport` stream.
- `patterns/*.jsonl`: self-learning pattern records derived from post-tool-use outcomes.
- `evals/skills/*.jsonl`: skill activation effectiveness event history.

Retention/pruning is configurable through `debug prune` and currently applies to:

- `.agent-p/telemetry/tokens/`
- `.agent-p/telemetry/progress/`
- `.agent-p/evals/skills/`

Storage authority is JSONL-only for Phase 10 observability/evals. SQLite
remains out of scope for telemetry in the current implementation.

## CLI outputs

- `stats` emits aggregate session metrics:
  - post-tool-use totals/decisions/latency
  - agent run totals/tokens/cost estimates
- `eval` derives evaluation input from session metrics and returns:
  - normalized score (`0..1`)
  - grade (`A|B|C|D`)
  - targeted recommendations for weak dimensions
- `debug agents` returns per-agent run statistics plus latest progress reports.
- `debug skills` returns aggregated effectiveness metrics by skill.
- `debug search` returns first-class search telemetry (`query`, `provider`, duration, result count, error samples).
- `debug tokens` returns token/cost summaries from middleware events.

## Command reference: `debug prune`

`debug prune` removes JSONL records older than configured retention windows and rewrites affected streams.

Default invocation (30 days for all supported streams):

```bash
agent-p debug prune
```

Tune each stream independently:

```bash
agent-p debug prune --tokens-max-age-days 14 --progress-max-age-days 7 --skills-max-age-days 60
```

Aggressive cleanup (keep only records with timestamp >= now):

```bash
agent-p debug prune --tokens-max-age-days 0 --progress-max-age-days 0 --skills-max-age-days 0
```

Output contract:

```json
{
  "streams": {
    "tokens": { "recordsDeleted": 0 },
    "progress": { "recordsDeleted": 0 },
    "skills": { "recordsDeleted": 0 }
  }
}
```
