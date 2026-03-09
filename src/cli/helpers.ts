import type { SkillEffectivenessStore } from "../evals/index.js";
import type { ProgressReportPipeline } from "../evals/index.js";
import type { SessionMetricsTracker } from "../telemetry/index.js";

export const asRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
};

export const estimateTokens = (value: unknown): number => {
  if (value === undefined) {
    return 0;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return 0;
    }

    return Math.max(0, Math.ceil(serialized.length / 4));
  } catch {
    return 0;
  }
};

export const clampProgress = (value: number): number =>
  Math.max(0, Math.min(100, Math.trunc(value)));

export interface SkillActivationInput {
  sessionId: string;
  skillName: string;
  success: boolean;
  latencyMs: number;
  tokens?: number;
}

export interface AgentExecutionInput {
  sessionId: string;
  agentId: string;
  success: boolean;
  durationMs: number;
  retries?: number;
  tokensIn?: number;
  tokensOut?: number;
  progress?: number;
}

export interface CliHelpers {
  recordSkillActivation: (input: SkillActivationInput) => void;
  recordAgentExecution: (input: AgentExecutionInput) => void;
}

export const createCliHelpers = (options: {
  skillEffectiveness?: SkillEffectivenessStore;
  telemetryTracker?: SessionMetricsTracker;
  progressReports?: ProgressReportPipeline;
}): CliHelpers => {
  const skillEffectiveness = options.skillEffectiveness;
  const telemetryTracker = options.telemetryTracker;
  const progressReports = options.progressReports;

  const recordSkillActivation = (input: SkillActivationInput): void => {
    if (!skillEffectiveness) {
      return;
    }

    skillEffectiveness.recordActivation({
      sessionId: input.sessionId,
      skillName: input.skillName,
      success: input.success,
      latencyMs: input.latencyMs,
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    });
  };

  const recordAgentExecution = (input: AgentExecutionInput): void => {
    telemetryTracker?.recordAgentRun({
      sessionId: input.sessionId,
      agentId: input.agentId,
      success: input.success,
      durationMs: input.durationMs,
      ...(input.retries !== undefined ? { retries: input.retries } : {}),
      ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
      ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
    });

    progressReports?.record({
      sessionId: input.sessionId,
      agent: input.agentId,
      status: input.success ? "completed" : "failed",
      progress: clampProgress(input.progress ?? (input.success ? 100 : 0)),
      tokens: (input.tokensIn ?? 0) + (input.tokensOut ?? 0),
      latencyMs: input.durationMs,
      retries: input.retries ?? 0,
    });
  };

  return {
    recordSkillActivation,
    recordAgentExecution,
  };
};

export interface VerifierTrustInputOptions {
  testPassRate?: number;
  reviewSeverity?: "low" | "medium" | "high" | "critical";
  completeness?: number;
  evidenceQuality?: number;
  coverage?: number;
  reproducibility?: number;
}

export const buildVerifierTrustInput = (
  options: VerifierTrustInputOptions,
): Partial<{
  testPassRate: number;
  reviewSeverity: "low" | "medium" | "high" | "critical";
  completeness: number;
  evidenceQuality: number;
  coverage: number;
  reproducibility: number;
}> => ({
  ...(options.testPassRate !== undefined
    ? { testPassRate: options.testPassRate }
    : {}),
  ...(options.reviewSeverity !== undefined
    ? { reviewSeverity: options.reviewSeverity }
    : {}),
  ...(options.completeness !== undefined
    ? { completeness: options.completeness }
    : {}),
  ...(options.evidenceQuality !== undefined
    ? { evidenceQuality: options.evidenceQuality }
    : {}),
  ...(options.coverage !== undefined ? { coverage: options.coverage } : {}),
  ...(options.reproducibility !== undefined
    ? { reproducibility: options.reproducibility }
    : {}),
});
