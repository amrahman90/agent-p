# Quality Module Documentation (Phase 6 Runtime + Safety Integrated)

## Goal

Define the quality gate architecture that evaluates trust and goal completion before delivery.

## Current boundary

- Implemented now:
  - runtime quality-path execution in `ExpertOrchestrator.executeQualityPath(...)`
  - deterministic quality-stage composition (`tester -> reviewer -> verifier`) through `composeQualityPath(...)`
  - centralized execution policy defaults (`DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY`)
  - explicit skip-reason mapping (`QUALITY_GATE_SKIP_REASON_MAP`) for auditable gate decisions
  - trust and goal gate checks at every stage with deterministic skip/continue behavior
  - dangerous-pattern detection for prompt injection, secret exfiltration, and destructive intent
  - stage resilience controls (timeout, retry, fail-open/fail-closed, circuit breaker, rate limiting)
  - normalized importance/stability metadata across policy, gate state, and quality summary
  - CLI runtime entrypoint `agents:quality <query>` with versioned payload
    - `contractVersion: "1.1.0"`
    - `policy`
    - `result` (includes `qualitySummary`)
  - unit/integration coverage for skip vs continue semantics and lineage/attempt validation
- Deferred:
  - adaptive rate limiting and external backoff tuning

## Implemented components

### 1) Execution policy and thresholds

- policy defaults are defined once in `src/agents/expert.ts`:
  - `minTrustScore = 0.75`
  - `minGoalCompletion = 1.0`
  - `enforceTrustGate = true`
  - `enforceGoalGate = true`
  - `continueOnTrustGateFailure = false`
  - `continueOnGoalGateFailure = false`
  - `stageTimeoutMs = 30000`
  - `maxStageRetries = 0`
  - `continueOnStageFailure = false`
  - `continueOnStageTimeout = false`
  - `circuitBreakerFailureThreshold = 2`
  - `rateLimitMaxExecutions = 0` (disabled by default)
  - `rateLimitWindowMs = 1000`
  - `continueOnRateLimit = false`
  - `importance = 3` (range: 1..5)
  - `stability = 3` (range: 1..5)
- stage inclusion defaults:
  - `includeTester = true`
  - `includeReviewer = true`
  - `includeVerifier = true`

### 2) Skip-reason mapping

- gate failure -> deterministic reason mapping:
  - trust gate failure -> `trust_gate`
  - goal gate failure -> `goal_gate`
  - stage failure -> `stage_failure`
  - stage timeout -> `stage_timeout`
  - circuit open -> `circuit_open`
  - rate limited -> `rate_limited`
- mapped through `QUALITY_GATE_SKIP_REASON_MAP` and applied in execution steps.

### 3) Dangerous-pattern detection

- shared detector `detectDangerousPatterns(...)` evaluates query and upstream analysis signals.
- categories:
  - `prompt_injection` -> `dangerous_prompt_injection`
  - `secret_exfiltration` -> `dangerous_secret_exfiltration`
  - `destructive_command` -> `dangerous_destructive_command`
- reviewer emits critical findings with `reasonCode`.
- verifier fails gate when dangerous patterns are present and returns reason codes.
- orchestrator forces gate failure (`trustScore=0`, `goalCompletion=0`) when dangerous patterns are detected in reviewer/verifier stages.

### 4) Quality-path composition policy

- defined as `ExpertQualityCompositionPolicy` in agent contracts
- consumed by `ExpertOrchestrator.composeQualityPath(...)`
- supports deterministic stage filtering with runtime execution wiring

### 5) Runtime entrypoint and contract

- CLI command `agents:quality <query>` dispatches to `executeQualityPath(...)`
- accepts stage, gate, and verifier trust-input options
- accepts optional metadata controls:
  - `--importance <1..5>`
  - `--stability <1..5>`
- returns versioned JSON payload:
  - `contractVersion`: `1.1.0`
  - `policy`: resolved runtime policy used for the run
  - `result`: handoffs, per-hop step status, final gate state, and `qualitySummary`
- `qualitySummary` fields:
  - `importance`: normalized policy score (1..5)
  - `stability`: normalized policy score (1..5)
  - `reasonCodes[]`: deterministic reason-code set for gate and resilience outcomes
  - `dangerousPatterns[]`: category + source + indicator records
  - `resilience`: retry/failure/timeout/circuit counters

### 6) Contract stability coverage

- unit and integration tests assert:
  - default chain order
  - policy-filtered chain generation
  - parent lineage propagation
  - trust/goal skip vs continue behavior via CLI (`agents:quality`)
  - snapshot matrix for `agents:quality`:
    - all-pass
    - trust-gate skip
    - goal-gate skip
    - continue-on-failure
    - stage-disabled
  - fail-open/fail-closed semantics for stage failures
  - deterministic timeout/retry accounting
  - dangerous-pattern reason code propagation
  - negative lineage/attempt validation for quality execution
  - CLI snapshot stability for existing commands

## Integration boundaries

- receives artifacts from workflow phases and agent handoffs
- writes deterministic gate decisions to runtime payloads
- telemetry/observability sink remains planned
- does not own code generation or search behavior

## Testing strategy

- unit tests for gate decisions and policy constants
- integration tests for CLI quality execution boundaries
- regression tests for dangerous-pattern detection rules
