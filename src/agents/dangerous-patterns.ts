import type { DangerousPatternMatch, QualityReasonCode } from "./types.js";

interface DangerousPatternRule {
  readonly category: DangerousPatternMatch["category"];
  readonly reasonCode: QualityReasonCode;
  readonly indicator: string;
  readonly pattern: RegExp;
}

const DANGEROUS_PATTERN_RULES: readonly DangerousPatternRule[] = [
  {
    category: "prompt_injection",
    reasonCode: "dangerous_prompt_injection",
    indicator: "Prompt-injection marker",
    pattern:
      /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|developer\s+message|jailbreak|do\s+anything\s+now)/i,
  },
  {
    category: "secret_exfiltration",
    reasonCode: "dangerous_secret_exfiltration",
    indicator: "Secret exfiltration request",
    pattern:
      /(?:(?:api[ _-]?key|access[ _-]?token|secret|password|credential).*(?:dump|exfiltrat|leak|send|upload|print)|(?:dump|exfiltrat|leak|send|upload|print).*(?:api[ _-]?key|access[ _-]?token|secret|password|credential)|(?:cat|type)\s+[^\n\r]*(?:\.env|id_rsa|credentials))/i,
  },
  {
    category: "destructive_command",
    reasonCode: "dangerous_destructive_command",
    indicator: "Destructive command intent",
    pattern:
      /(?:\brm\s+-rf\b|\bdel\s+\/f\b|\bformat\s+[a-z]:\b|\bdrop\s+database\b|\btruncate\s+table\b|\bshutdown\b)/i,
  },
];

const collectSignalTexts = (input: {
  readonly query: string;
  readonly analysis?: {
    readonly notes?: readonly string[];
    readonly risks?: readonly string[];
    readonly summary?: string;
  };
}): Array<{ source: DangerousPatternMatch["source"]; text: string }> => {
  const analysisNotes = input.analysis?.notes ?? [];
  const analysisRisks = input.analysis?.risks ?? [];
  const analysisSummary = input.analysis?.summary;

  return [
    { source: "query", text: input.query },
    ...analysisNotes.map((text) => ({ source: "analysis" as const, text })),
    ...analysisRisks.map((text) => ({ source: "analysis" as const, text })),
    ...(analysisSummary !== undefined
      ? [{ source: "analysis" as const, text: analysisSummary }]
      : []),
  ];
};

export const detectDangerousPatterns = (input: {
  readonly query: string;
  readonly analysis?: {
    readonly notes?: readonly string[];
    readonly risks?: readonly string[];
    readonly summary?: string;
  };
}): DangerousPatternMatch[] => {
  const signals = collectSignalTexts(input);
  const matches: DangerousPatternMatch[] = [];

  for (const signal of signals) {
    for (const rule of DANGEROUS_PATTERN_RULES) {
      if (!rule.pattern.test(signal.text)) {
        continue;
      }

      const alreadyMatched = matches.some(
        (match) => match.reasonCode === rule.reasonCode,
      );
      if (alreadyMatched) {
        continue;
      }

      matches.push({
        category: rule.category,
        reasonCode: rule.reasonCode,
        indicator: rule.indicator,
        source: signal.source,
      });
    }
  }

  return matches;
};
