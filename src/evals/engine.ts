import {
  evaluationInputSchema,
  evaluationResultSchema,
  type EvaluationInput,
  type EvaluationResult,
} from "./types.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const gradeFromScore = (score: number): "A" | "B" | "C" | "D" => {
  if (score >= 0.85) {
    return "A";
  }

  if (score >= 0.7) {
    return "B";
  }

  if (score >= 0.55) {
    return "C";
  }

  return "D";
};

const latencyScore = (averageLatencyMs: number): number => {
  if (averageLatencyMs <= 250) {
    return 1;
  }

  if (averageLatencyMs >= 3000) {
    return 0;
  }

  return clamp01(1 - (averageLatencyMs - 250) / 2750);
};

export class EvaluationEngine {
  evaluate(input: EvaluationInput): EvaluationResult {
    const validated = evaluationInputSchema.parse(input);
    const latency = latencyScore(validated.averageLatencyMs);
    const retryPenalty = validated.retryRate;
    const overallScore = clamp01(
      validated.trustScore * 0.35 +
        validated.successRate * 0.3 +
        validated.activationAccuracy * 0.2 +
        latency * 0.15 -
        retryPenalty * 0.1,
    );

    const recommendations: string[] = [];
    if (validated.trustScore < 0.75) {
      recommendations.push(
        "Increase verifier evidence quality and rigor inputs",
      );
    }
    if (validated.successRate < 0.8) {
      recommendations.push(
        "Reduce failed handoffs before quality gate completion",
      );
    }
    if (validated.activationAccuracy < 0.85) {
      recommendations.push(
        "Tune skill triggers to improve activation accuracy",
      );
    }
    if (validated.averageLatencyMs > 1200) {
      recommendations.push("Reduce median stage latency in search/agent paths");
    }
    if (validated.retryRate > 0.2) {
      recommendations.push(
        "Investigate retry spikes and tighten failure handling",
      );
    }

    return evaluationResultSchema.parse({
      overallScore,
      grade: gradeFromScore(overallScore),
      components: {
        trustScore: validated.trustScore,
        successRate: validated.successRate,
        activationAccuracy: validated.activationAccuracy,
        latencyScore: latency,
        retryPenalty,
      },
      recommendations,
    });
  }
}
