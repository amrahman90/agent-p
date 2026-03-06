import { createHash } from "node:crypto";

import type {
  AgentHandoffPayload,
  AgentRole,
  DangerousPatternMatch,
  ExpertQualityCompositionPolicy,
  ExpertQualityExecutionPolicy,
  ExpertQualityExecutionRequest,
  ExpertQualityExecutionResult,
  ExpertQualityExecutionStep,
  ExpertQualityGateState,
  QualityReasonCode,
  ExpertQualitySkipReason,
  ExpertPlanningRequest,
  ExpertQualitySubagents,
} from "./types.js";
import { validateAgentHandoffPayload } from "./types.js";
import { detectDangerousPatterns } from "./dangerous-patterns.js";

type Clock = () => number;

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const DEFAULT_MIN_TRUST_SCORE = 0.75;
const DEFAULT_MIN_GOAL_COMPLETION = 1;
const DEFAULT_TRUST_SCORE = 1;
const DEFAULT_GOAL_COMPLETION = 1;
const DEFAULT_IMPORTANCE = 3;
const DEFAULT_STABILITY = 3;
const DEFAULT_STAGE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STAGE_RETRIES = 0;
const DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 2;
const DEFAULT_RATE_LIMIT_MAX_EXECUTIONS = 0;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 1_000;

export const DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY: Readonly<
  Required<
    Pick<
      ExpertQualityExecutionPolicy,
      | "includeTester"
      | "includeReviewer"
      | "includeVerifier"
      | "importance"
      | "stability"
      | "enforceTrustGate"
      | "enforceGoalGate"
      | "minTrustScore"
      | "minGoalCompletion"
      | "continueOnTrustGateFailure"
      | "continueOnGoalGateFailure"
      | "stageTimeoutMs"
      | "maxStageRetries"
      | "continueOnStageFailure"
      | "continueOnStageTimeout"
      | "circuitBreakerFailureThreshold"
      | "rateLimitMaxExecutions"
      | "rateLimitWindowMs"
      | "continueOnRateLimit"
    >
  >
> = Object.freeze({
  includeTester: true,
  includeReviewer: true,
  includeVerifier: true,
  importance: DEFAULT_IMPORTANCE,
  stability: DEFAULT_STABILITY,
  enforceTrustGate: true,
  enforceGoalGate: true,
  minTrustScore: DEFAULT_MIN_TRUST_SCORE,
  minGoalCompletion: DEFAULT_MIN_GOAL_COMPLETION,
  continueOnTrustGateFailure: false,
  continueOnGoalGateFailure: false,
  stageTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS,
  maxStageRetries: DEFAULT_MAX_STAGE_RETRIES,
  continueOnStageFailure: false,
  continueOnStageTimeout: false,
  circuitBreakerFailureThreshold: DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  rateLimitMaxExecutions: DEFAULT_RATE_LIMIT_MAX_EXECUTIONS,
  rateLimitWindowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
  continueOnRateLimit: false,
});

export const QUALITY_GATE_SKIP_REASON_MAP: Readonly<
  Record<
    | "trustFailure"
    | "goalFailure"
    | "stageFailure"
    | "stageTimeout"
    | "circuitOpen"
    | "rateLimited",
    ExpertQualitySkipReason
  >
> = Object.freeze({
  trustFailure: "trust_gate",
  goalFailure: "goal_gate",
  stageFailure: "stage_failure",
  stageTimeout: "stage_timeout",
  circuitOpen: "circuit_open",
  rateLimited: "rate_limited",
});

const STAGE_FAILURE_REASON_CODE = "stage_execution_failed" as const;
const STAGE_TIMEOUT_REASON_CODE = "stage_execution_timeout" as const;
const TRUST_GATE_REASON_CODE = "trust_score_below_threshold" as const;
const GOAL_GATE_REASON_CODE = "goal_completion_below_threshold" as const;
const CIRCUIT_OPEN_REASON_CODE = "resilience_circuit_open" as const;
const RATE_LIMIT_REASON_CODE = "resilience_rate_limited" as const;

class StageTimeoutError extends Error {
  constructor(stage: AgentRole, timeoutMs: number) {
    super(`Stage '${stage}' exceeded timeout ${timeoutMs}ms`);
    this.name = "StageTimeoutError";
  }
}

interface ResolvedExpertQualityExecutionPolicy {
  readonly includeTester: boolean;
  readonly includeReviewer: boolean;
  readonly includeVerifier: boolean;
  readonly importance: number;
  readonly stability: number;
  readonly enforceTrustGate: boolean;
  readonly enforceGoalGate: boolean;
  readonly minTrustScore: number;
  readonly minGoalCompletion: number;
  readonly continueOnTrustGateFailure: boolean;
  readonly continueOnGoalGateFailure: boolean;
  readonly stageTimeoutMs: number;
  readonly maxStageRetries: number;
  readonly continueOnStageFailure: boolean;
  readonly continueOnStageTimeout: boolean;
  readonly circuitBreakerFailureThreshold: number;
  readonly rateLimitMaxExecutions: number;
  readonly rateLimitWindowMs: number;
  readonly continueOnRateLimit: boolean;
}

const resolveQualityExecutionPolicy = (
  policy: ExpertQualityExecutionPolicy,
): ResolvedExpertQualityExecutionPolicy => ({
  includeTester:
    policy.includeTester ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.includeTester,
  includeReviewer:
    policy.includeReviewer ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.includeReviewer,
  includeVerifier:
    policy.includeVerifier ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.includeVerifier,
  importance: clamp(
    Math.trunc(
      policy.importance ?? DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.importance,
    ),
    1,
    5,
  ),
  stability: clamp(
    Math.trunc(
      policy.stability ?? DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.stability,
    ),
    1,
    5,
  ),
  enforceTrustGate:
    policy.enforceTrustGate ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.enforceTrustGate,
  enforceGoalGate:
    policy.enforceGoalGate ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.enforceGoalGate,
  minTrustScore: clamp(
    policy.minTrustScore ??
      DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.minTrustScore,
    0,
    1,
  ),
  minGoalCompletion: clamp(
    policy.minGoalCompletion ??
      DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.minGoalCompletion,
    0,
    1,
  ),
  continueOnTrustGateFailure:
    policy.continueOnTrustGateFailure ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.continueOnTrustGateFailure,
  continueOnGoalGateFailure:
    policy.continueOnGoalGateFailure ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.continueOnGoalGateFailure,
  stageTimeoutMs: Math.max(
    1,
    Math.trunc(
      policy.stageTimeoutMs ??
        DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.stageTimeoutMs,
    ),
  ),
  maxStageRetries: Math.max(
    0,
    Math.trunc(
      policy.maxStageRetries ??
        DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.maxStageRetries,
    ),
  ),
  continueOnStageFailure:
    policy.continueOnStageFailure ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.continueOnStageFailure,
  continueOnStageTimeout:
    policy.continueOnStageTimeout ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.continueOnStageTimeout,
  circuitBreakerFailureThreshold: Math.max(
    1,
    Math.trunc(
      policy.circuitBreakerFailureThreshold ??
        DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.circuitBreakerFailureThreshold,
    ),
  ),
  rateLimitMaxExecutions: Math.max(
    0,
    Math.trunc(
      policy.rateLimitMaxExecutions ??
        DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.rateLimitMaxExecutions,
    ),
  ),
  rateLimitWindowMs: Math.max(
    1,
    Math.trunc(
      policy.rateLimitWindowMs ??
        DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.rateLimitWindowMs,
    ),
  ),
  continueOnRateLimit:
    policy.continueOnRateLimit ??
    DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY.continueOnRateLimit,
});

const resolveSkipReason = (
  gateState: ExpertQualityGateState,
  policy: ResolvedExpertQualityExecutionPolicy,
): ExpertQualitySkipReason | undefined => {
  if (!gateState.trustPassed && !policy.continueOnTrustGateFailure) {
    return QUALITY_GATE_SKIP_REASON_MAP.trustFailure;
  }

  if (!gateState.goalPassed && !policy.continueOnGoalGateFailure) {
    return QUALITY_GATE_SKIP_REASON_MAP.goalFailure;
  }

  return undefined;
};

const withTimeout = async <T>(
  stage: AgentRole,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StageTimeoutError(stage, timeoutMs));
    }, timeoutMs);

    operation()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const isDangerousReasonCode = (value: string): value is QualityReasonCode =>
  value.startsWith("dangerous_");

const dedupeDangerousPatterns = (
  values: readonly DangerousPatternMatch[],
): DangerousPatternMatch[] => {
  const seen = new Set<string>();
  const deduped: DangerousPatternMatch[] = [];

  for (const value of values) {
    const key = `${value.reasonCode}:${value.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
};

export class ExpertOrchestrator {
  constructor(private readonly clock: Clock = Date.now) {}

  private generateHandoffId(
    to: AgentRole,
    request: ExpertPlanningRequest,
    timestamp: number,
    attempt: number,
  ): string {
    const digest = createHash("sha1")
      .update(
        `${request.sessionId}:${to}:${request.query}:${timestamp}:${attempt}`,
      )
      .digest("hex")
      .slice(0, 16);
    return `h-${to}-${digest}`;
  }

  private createHandoff(
    to: AgentRole,
    request: ExpertPlanningRequest,
    defaultReason: string,
  ): AgentHandoffPayload {
    const attempt = request.attempt ?? 1;
    const timestamp = this.clock();

    return {
      from: "expert",
      to,
      sessionId: request.sessionId,
      handoffId:
        request.handoffId ??
        this.generateHandoffId(to, request, timestamp, attempt),
      ...(request.parentHandoffId !== undefined
        ? { parentHandoffId: request.parentHandoffId }
        : {}),
      attempt,
      query: request.query,
      filePaths: dedupe(request.filePaths ?? []),
      domains: dedupe(request.domains ?? []),
      metadata: {
        reason: request.reason ?? defaultReason,
        priority: request.priority ?? "normal",
        timestamp,
      },
    };
  }

  createScoutHandoff(request: ExpertPlanningRequest): AgentHandoffPayload {
    return this.createHandoff("scout", request, "context_discovery");
  }

  createBuilderHandoff(request: ExpertPlanningRequest): AgentHandoffPayload {
    return this.createHandoff("builder", request, "implementation_planning");
  }

  createTesterHandoff(request: ExpertPlanningRequest): AgentHandoffPayload {
    return this.createHandoff("tester", request, "test_planning");
  }

  createReviewerHandoff(request: ExpertPlanningRequest): AgentHandoffPayload {
    return this.createHandoff("reviewer", request, "code_review");
  }

  createVerifierHandoff(request: ExpertPlanningRequest): AgentHandoffPayload {
    return this.createHandoff("verifier", request, "quality_verification");
  }

  composeQualityPath(
    request: ExpertPlanningRequest,
    policy: ExpertQualityCompositionPolicy = {},
  ): AgentHandoffPayload[] {
    const includeTester = policy.includeTester ?? true;
    const includeReviewer = policy.includeReviewer ?? true;
    const includeVerifier = policy.includeVerifier ?? true;

    const handoffs: AgentHandoffPayload[] = [];
    let parentHandoffId = request.parentHandoffId;

    if (includeTester) {
      const testerHandoff = this.createTesterHandoff({
        ...request,
        ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
      });
      handoffs.push(testerHandoff);
      parentHandoffId = testerHandoff.handoffId;
    }

    if (includeReviewer) {
      const reviewerHandoff = this.createReviewerHandoff({
        ...request,
        ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
      });
      handoffs.push(reviewerHandoff);
      parentHandoffId = reviewerHandoff.handoffId;
    }

    if (includeVerifier) {
      handoffs.push(
        this.createVerifierHandoff({
          ...request,
          ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
        }),
      );
    }

    return handoffs;
  }

  async executeQualityPath(
    request: ExpertQualityExecutionRequest,
    subagents: ExpertQualitySubagents,
    policy: ExpertQualityExecutionPolicy = {},
  ): Promise<ExpertQualityExecutionResult> {
    const resolvedPolicy = resolveQualityExecutionPolicy(policy);
    const handoffs = this.composeQualityPath(request, resolvedPolicy).map(
      (handoff) => validateAgentHandoffPayload(handoff),
    );

    let currentTrustScore = clamp(
      request.gateInput?.trustScore ?? DEFAULT_TRUST_SCORE,
      0,
      1,
    );
    let currentGoalCompletion = clamp(
      request.gateInput?.goalCompletion ?? DEFAULT_GOAL_COMPLETION,
      0,
      1,
    );

    const steps: ExpertQualityExecutionStep[] = [];
    const reasonCodes = new Set<QualityReasonCode>();
    let dangerousPatterns: DangerousPatternMatch[] = [];
    let blockingSkipReason: ExpertQualitySkipReason | undefined;
    let consecutiveStageFailures = 0;
    const resilience = {
      retries: 0,
      failures: 0,
      timeouts: 0,
      circuitOpen: false,
      rateLimited: 0,
    };
    const rateLimitAttemptTimestamps: number[] = [];

    const addReasonCode = (value: QualityReasonCode): void => {
      reasonCodes.add(value);
    };

    const addReasonCodes = (values: readonly QualityReasonCode[]): void => {
      for (const value of values) {
        reasonCodes.add(value);
      }
    };

    const collectDangerousPatterns = (
      handoff: AgentHandoffPayload,
    ): DangerousPatternMatch[] =>
      detectDangerousPatterns({
        query: handoff.query,
        ...(handoff.analysis !== undefined
          ? { analysis: handoff.analysis }
          : {}),
      });

    const addDangerousPatterns = (
      patterns: readonly DangerousPatternMatch[],
    ): void => {
      dangerousPatterns = dedupeDangerousPatterns([
        ...dangerousPatterns,
        ...patterns,
      ]);
      addReasonCodes(patterns.map((pattern) => pattern.reasonCode));
    };

    const toGateState = (): ExpertQualityGateState => ({
      trustScore: currentTrustScore,
      goalCompletion: currentGoalCompletion,
      importance: resolvedPolicy.importance,
      stability: resolvedPolicy.stability,
      trustPassed:
        !resolvedPolicy.enforceTrustGate ||
        currentTrustScore >= resolvedPolicy.minTrustScore,
      goalPassed:
        !resolvedPolicy.enforceGoalGate ||
        currentGoalCompletion >= resolvedPolicy.minGoalCompletion,
    });

    for (const handoff of handoffs) {
      const gateState = toGateState();

      if (blockingSkipReason !== undefined) {
        if (blockingSkipReason === QUALITY_GATE_SKIP_REASON_MAP.stageFailure) {
          addReasonCode(STAGE_FAILURE_REASON_CODE);
        }
        if (blockingSkipReason === QUALITY_GATE_SKIP_REASON_MAP.stageTimeout) {
          addReasonCode(STAGE_TIMEOUT_REASON_CODE);
        }
        if (blockingSkipReason === QUALITY_GATE_SKIP_REASON_MAP.circuitOpen) {
          addReasonCode(CIRCUIT_OPEN_REASON_CODE);
        }
        if (blockingSkipReason === QUALITY_GATE_SKIP_REASON_MAP.rateLimited) {
          addReasonCode(RATE_LIMIT_REASON_CODE);
        }
        steps.push({
          handoff,
          status: "skipped",
          gateState,
          skipReason: blockingSkipReason,
        });
        continue;
      }

      if (resilience.circuitOpen) {
        addReasonCode(CIRCUIT_OPEN_REASON_CODE);
        steps.push({
          handoff,
          status: "skipped",
          gateState,
          skipReason: QUALITY_GATE_SKIP_REASON_MAP.circuitOpen,
        });
        continue;
      }

      const skipReason = resolveSkipReason(gateState, resolvedPolicy);
      if (skipReason !== undefined) {
        if (skipReason === QUALITY_GATE_SKIP_REASON_MAP.trustFailure) {
          addReasonCode(TRUST_GATE_REASON_CODE);
        }
        if (skipReason === QUALITY_GATE_SKIP_REASON_MAP.goalFailure) {
          addReasonCode(GOAL_GATE_REASON_CODE);
        }
        steps.push({
          handoff,
          status: "skipped",
          gateState,
          skipReason,
        });
        continue;
      }

      let attempts = 0;
      for (; attempts <= resolvedPolicy.maxStageRetries; attempts += 1) {
        const startedAt = this.clock();

        if (resolvedPolicy.rateLimitMaxExecutions > 0) {
          const windowStart = startedAt - resolvedPolicy.rateLimitWindowMs;
          while (
            rateLimitAttemptTimestamps.length > 0 &&
            (rateLimitAttemptTimestamps[0] ?? startedAt) < windowStart
          ) {
            rateLimitAttemptTimestamps.shift();
          }

          if (
            rateLimitAttemptTimestamps.length >=
            resolvedPolicy.rateLimitMaxExecutions
          ) {
            addReasonCode(RATE_LIMIT_REASON_CODE);
            resilience.rateLimited += 1;
            steps.push({
              handoff,
              status: "skipped",
              gateState,
              skipReason: QUALITY_GATE_SKIP_REASON_MAP.rateLimited,
              attempts: attempts + 1,
              durationMs: Math.max(0, this.clock() - startedAt),
              failureReasonCode: RATE_LIMIT_REASON_CODE,
            });

            if (!resolvedPolicy.continueOnRateLimit) {
              blockingSkipReason = QUALITY_GATE_SKIP_REASON_MAP.rateLimited;
            }
            break;
          }

          rateLimitAttemptTimestamps.push(startedAt);
        }

        try {
          if (handoff.to === "tester") {
            const result = await withTimeout(
              handoff.to,
              resolvedPolicy.stageTimeoutMs,
              async () => await subagents.tester.plan({ handoff }),
            );
            consecutiveStageFailures = 0;
            steps.push({
              handoff,
              status: "executed",
              gateState,
              result,
              attempts: attempts + 1,
              durationMs: Math.max(0, this.clock() - startedAt),
            });
            break;
          }

          if (handoff.to === "reviewer") {
            const result = await withTimeout(
              handoff.to,
              resolvedPolicy.stageTimeoutMs,
              async () => await subagents.reviewer.assess({ handoff }),
            );
            const stageDangerousPatterns = collectDangerousPatterns(handoff);
            if (stageDangerousPatterns.length > 0) {
              addDangerousPatterns(stageDangerousPatterns);
              currentTrustScore = 0;
              currentGoalCompletion = 0;
            }
            consecutiveStageFailures = 0;
            steps.push({
              handoff,
              status: "executed",
              gateState,
              result,
              attempts: attempts + 1,
              durationMs: Math.max(0, this.clock() - startedAt),
            });
            break;
          }

          if (handoff.to === "verifier") {
            const result = await withTimeout(
              handoff.to,
              resolvedPolicy.stageTimeoutMs,
              async () =>
                await subagents.verifier.assess({
                  handoff,
                  ...(request.verifierTrustInput !== undefined
                    ? { trustInput: request.verifierTrustInput }
                    : {}),
                }),
            );

            const verifierReasonCodes = result.reasonCodes ?? [];
            addReasonCodes(verifierReasonCodes);

            const stageDangerousPatterns = collectDangerousPatterns(handoff);
            if (stageDangerousPatterns.length > 0) {
              addDangerousPatterns(stageDangerousPatterns);
            }

            const hasDangerousReasonCode = verifierReasonCodes.some((code) =>
              isDangerousReasonCode(code),
            );
            if (hasDangerousReasonCode || stageDangerousPatterns.length > 0) {
              currentTrustScore = 0;
              currentGoalCompletion = 0;
            } else {
              currentTrustScore = result.trustScore;
              currentGoalCompletion = result.gateDecision === "pass" ? 1 : 0;
            }

            consecutiveStageFailures = 0;
            steps.push({
              handoff,
              status: "executed",
              gateState,
              result,
              attempts: attempts + 1,
              durationMs: Math.max(0, this.clock() - startedAt),
            });
            break;
          }

          throw new Error(`Unsupported quality stage: ${handoff.to}`);
        } catch (error: unknown) {
          const finalAttempt = attempts >= resolvedPolicy.maxStageRetries;
          if (!finalAttempt) {
            resilience.retries += 1;
            continue;
          }

          const timedOut = error instanceof StageTimeoutError;
          const skipReason = timedOut
            ? QUALITY_GATE_SKIP_REASON_MAP.stageTimeout
            : QUALITY_GATE_SKIP_REASON_MAP.stageFailure;
          const failureReasonCode = timedOut
            ? (STAGE_TIMEOUT_REASON_CODE as QualityReasonCode)
            : (STAGE_FAILURE_REASON_CODE as QualityReasonCode);

          addReasonCode(failureReasonCode);
          if (timedOut) {
            resilience.timeouts += 1;
          } else {
            resilience.failures += 1;
          }
          consecutiveStageFailures += 1;

          if (
            consecutiveStageFailures >=
            resolvedPolicy.circuitBreakerFailureThreshold
          ) {
            resilience.circuitOpen = true;
            addReasonCode(CIRCUIT_OPEN_REASON_CODE);
          }

          steps.push({
            handoff,
            status: "skipped",
            gateState,
            skipReason,
            attempts: attempts + 1,
            durationMs: Math.max(0, this.clock() - startedAt),
            failureReasonCode,
          });

          const continueAfterFailure = timedOut
            ? resolvedPolicy.continueOnStageTimeout
            : resolvedPolicy.continueOnStageFailure;
          if (!continueAfterFailure) {
            blockingSkipReason = skipReason;
          }
          break;
        }
      }
    }

    return {
      handoffs,
      steps,
      finalGateState: toGateState(),
      qualitySummary: {
        importance: resolvedPolicy.importance,
        stability: resolvedPolicy.stability,
        reasonCodes: Array.from(reasonCodes).sort(),
        dangerousPatterns,
        resilience,
      },
    };
  }
}
