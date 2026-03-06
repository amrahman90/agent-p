import type {
  ReviewerAssessmentRequest,
  ReviewerAssessmentResult,
  ReviewerFinding,
} from "./types.js";
import { detectDangerousPatterns } from "./dangerous-patterns.js";

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

export class ReviewerSubagent {
  async assess(
    request: ReviewerAssessmentRequest,
  ): Promise<ReviewerAssessmentResult> {
    const handoff = request.handoff;

    const findings: ReviewerFinding[] = [
      {
        severity: "medium",
        finding:
          "Reviewer remains scaffold-only and does not inspect code diffs yet.",
        recommendedFix:
          "Run reviewer with concrete diff context after builder implementation is available.",
      },
    ];

    if (handoff.filePaths.length === 0) {
      findings.push({
        severity: "low",
        finding: "No file path hints were provided in the review handoff.",
        recommendedFix:
          "Include changed file paths to improve finding precision and coverage.",
      });
    }

    const uniqueRisks = dedupe(handoff.analysis?.risks ?? []);
    if (uniqueRisks.length > 0) {
      findings.push({
        severity: "high",
        finding: `Upstream risk requires review attention: ${uniqueRisks[0]}`,
        recommendedFix:
          "Address the risk before merge and attach validation evidence to the handoff.",
      });
    }

    const dangerousPatterns = detectDangerousPatterns({
      query: handoff.query,
      ...(handoff.analysis !== undefined ? { analysis: handoff.analysis } : {}),
    });
    for (const pattern of dangerousPatterns) {
      findings.push({
        severity: "critical",
        finding: `${pattern.indicator} detected from ${pattern.source} signal.`,
        recommendedFix:
          "Abort execution, remove dangerous instruction intent, and rerun with safe constraints.",
        reasonCode: pattern.reasonCode,
      });
    }

    return {
      summary: `Reviewer scaffold produced ${findings.length} findings for: ${handoff.query}`,
      findings,
    };
  }
}
