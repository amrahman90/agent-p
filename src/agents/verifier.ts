import type {
  QualityReasonCode,
  VerifierAssessmentRequest,
  VerifierAssessmentResult,
  VerifierTrustInput,
} from "./types.js";
import { verifierTrustInputSchema } from "./types.js";
import { detectDangerousPatterns } from "./dangerous-patterns.js";

const DEFAULT_TRUST_THRESHOLD = 0.75;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const TRUST_SCORE_COMPONENT_WEIGHTS = Object.freeze({
  testPassRate: 0.35,
  completeness: 0.2,
  evidenceQuality: 0.2,
  coverage: 0.15,
  reproducibility: 0.1,
});

const severityPenalty = (
  severity: VerifierTrustInput["reviewSeverity"],
): number => {
  switch (severity) {
    case "low":
      return 0.05;
    case "medium":
      return 0.2;
    case "high":
      return 0.45;
    case "critical":
      return 0.75;
  }
};

export class VerifierSubagent {
  async assess(
    request: VerifierAssessmentRequest,
  ): Promise<VerifierAssessmentResult> {
    const handoff = request.handoff;
    const trustInput = verifierTrustInputSchema.parse(request.trustInput ?? {});

    const coverage = trustInput.coverage ?? trustInput.completeness;
    const reproducibility =
      trustInput.reproducibility ?? trustInput.evidenceQuality;

    const weightedScore =
      trustInput.testPassRate * TRUST_SCORE_COMPONENT_WEIGHTS.testPassRate +
      trustInput.completeness * TRUST_SCORE_COMPONENT_WEIGHTS.completeness +
      trustInput.evidenceQuality *
        TRUST_SCORE_COMPONENT_WEIGHTS.evidenceQuality +
      coverage * TRUST_SCORE_COMPONENT_WEIGHTS.coverage +
      reproducibility * TRUST_SCORE_COMPONENT_WEIGHTS.reproducibility -
      severityPenalty(trustInput.reviewSeverity);

    const trustScore = round3(clamp(weightedScore, 0, 1));

    const blockers: string[] = [];
    const reasonCodes: QualityReasonCode[] = [];
    if (trustInput.testPassRate < 1) {
      blockers.push("Test pass rate is below required 1.0 for release gate.");
      reasonCodes.push("trust_test_pass_rate_low");
    }
    if (
      trustInput.reviewSeverity === "high" ||
      trustInput.reviewSeverity === "critical"
    ) {
      blockers.push("Reviewer severity is high or critical.");
      reasonCodes.push("trust_review_severity_high");
    }
    if (trustScore < DEFAULT_TRUST_THRESHOLD) {
      blockers.push(
        `Trust score ${trustScore.toFixed(3)} is below threshold ${DEFAULT_TRUST_THRESHOLD.toFixed(2)}.`,
      );
      reasonCodes.push("trust_score_below_threshold");
    }

    const dangerousPatterns = detectDangerousPatterns({
      query: handoff.query,
      ...(handoff.analysis !== undefined ? { analysis: handoff.analysis } : {}),
    });
    for (const pattern of dangerousPatterns) {
      blockers.push(
        `${pattern.indicator} detected from ${pattern.source} signal.`,
      );
      reasonCodes.push(pattern.reasonCode);
    }

    return {
      summary: `Verifier scaffold evaluated release gate for: ${handoff.query}`,
      trustScore,
      threshold: DEFAULT_TRUST_THRESHOLD,
      gateDecision: blockers.length === 0 ? "pass" : "fail",
      checks: [
        `testPassRate=${trustInput.testPassRate.toFixed(3)}`,
        `reviewSeverity=${trustInput.reviewSeverity}`,
        `completeness=${trustInput.completeness.toFixed(3)}`,
        `evidenceQuality=${trustInput.evidenceQuality.toFixed(3)}`,
        `coverage=${coverage.toFixed(3)}`,
        `reproducibility=${reproducibility.toFixed(3)}`,
      ],
      blockers,
      ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
    };
  }
}
