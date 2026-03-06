import type {
  AgentFileConfidence,
  ScoutAnalysisRequest,
  ScoutAnalysisResult,
  ScoutMemoryService,
  ScoutSearchService,
} from "./types.js";

const TOP_FILE_LIMIT = 10;

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundConfidence = (value: number): number =>
  Math.round(value * 1000) / 1000;

const tokenize = (value: string): string[] =>
  dedupe((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean));

const inferDomainsFromFilePaths = (filePaths: readonly string[]): string[] => {
  const inferred = new Set<string>();

  for (const filePath of filePaths) {
    const normalized = filePath.toLowerCase();
    if (normalized.endsWith(".tsx") || normalized.endsWith(".jsx")) {
      inferred.add("frontend");
    }
    if (
      normalized.endsWith(".ts") ||
      normalized.endsWith(".js") ||
      normalized.includes("api") ||
      normalized.includes("server")
    ) {
      inferred.add("backend");
    }
    if (normalized.includes("test") || normalized.includes("spec")) {
      inferred.add("testing");
    }
  }

  return Array.from(inferred);
};

const inferDomainsFromFilePath = (filePath: string): string[] =>
  inferDomainsFromFilePaths([filePath]);

const normalizePathTokens = (filePath: string): string[] =>
  dedupe(
    filePath
      .toLowerCase()
      .split(/[\\/._-]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length >= 3),
  );

const buildMemoryCorpus = (
  memory: ScoutMemoryService | undefined,
  sessionId: string,
  query: string,
): readonly string[] => {
  const entries = memory?.searchSession(query, sessionId, 5) ?? [];
  return entries.map((entry) =>
    `${entry.scope} ${entry.key} ${JSON.stringify(entry.value)}`.toLowerCase(),
  );
};

const hasMemoryHit = (
  filePath: string,
  memoryCorpus: readonly string[],
): boolean => {
  if (memoryCorpus.length === 0) {
    return false;
  }

  const pathTokens = normalizePathTokens(filePath);
  return pathTokens.some((token) =>
    memoryCorpus.some((memoryText) => memoryText.includes(token)),
  );
};

const buildSearchNotes = (
  totalCandidates: number,
  rankedFilesCount: number,
): string[] => [
  `Search returned ${totalCandidates} candidate hits.`,
  `Top ${rankedFilesCount} files ranked with deterministic tie-breakers.`,
];

const buildMemoryNotes = (memoryCorpusCount: number): string[] => {
  if (memoryCorpusCount === 0) {
    return [];
  }

  return [`Memory matched ${memoryCorpusCount} related entries.`];
};

interface FileSignals {
  readonly filePath: string;
  readonly previews: readonly string[];
  readonly searchScore: number;
  readonly hitCount: number;
  readonly fromHandoff: boolean;
}

const rankFileSignals = (
  signals: readonly FileSignals[],
  queryTokens: readonly string[],
  handoffDomains: readonly string[],
  memoryCorpus: readonly string[],
): AgentFileConfidence[] => {
  const normalizedHandoffDomains = handoffDomains.map((domain) =>
    domain.toLowerCase(),
  );

  const ranked = signals.map((signal) => {
    const previewsText = signal.previews.join(" ").toLowerCase();
    const matchedTermCount = queryTokens.filter((token) =>
      previewsText.includes(token),
    ).length;
    const matchedTermsRatio =
      queryTokens.length === 0 ? 0 : matchedTermCount / queryTokens.length;
    const normalizedSearchScore = clamp(signal.searchScore / 10, 0, 1);

    const inferredDomains = inferDomainsFromFilePath(signal.filePath);
    const overlappingDomains = inferredDomains.filter((domain) =>
      normalizedHandoffDomains.includes(domain),
    );
    const memoryHit = hasMemoryHit(signal.filePath, memoryCorpus);

    const rawConfidence =
      normalizedSearchScore * 0.55 +
      matchedTermsRatio * 0.25 +
      Math.min(signal.hitCount, 5) * 0.03 +
      (memoryHit ? 0.12 : 0) +
      (overlappingDomains.length > 0 ? 0.08 : 0) +
      (signal.fromHandoff ? 0.04 : 0);

    const reasons = [
      `matched terms (${matchedTermCount}/${queryTokens.length})`,
      ...(memoryHit ? ["memory hit"] : []),
      ...(overlappingDomains.length > 0
        ? [`domain overlap (${overlappingDomains.join(",")})`]
        : []),
    ];

    return {
      filePath: signal.filePath,
      confidence: roundConfidence(clamp(rawConfidence, 0, 1)),
      reasons,
      matchedTermCount,
      searchScore: signal.searchScore,
      hitCount: signal.hitCount,
    };
  });

  ranked.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }

    if (right.matchedTermCount !== left.matchedTermCount) {
      return right.matchedTermCount - left.matchedTermCount;
    }

    if (right.hitCount !== left.hitCount) {
      return right.hitCount - left.hitCount;
    }

    return left.filePath.localeCompare(right.filePath);
  });

  return ranked.slice(0, TOP_FILE_LIMIT).map((entry) => ({
    filePath: entry.filePath,
    confidence: entry.confidence,
    reasons: entry.reasons,
  }));
};

export class ScoutSubagent {
  constructor(
    private readonly search: ScoutSearchService,
    private readonly memory?: ScoutMemoryService,
  ) {}

  async analyze(request: ScoutAnalysisRequest): Promise<ScoutAnalysisResult> {
    const handoff = request.handoff;
    const searchResponse = await this.search.query({
      sessionId: handoff.sessionId,
      query: handoff.query,
      limit: 20,
    });
    const memoryCorpus = buildMemoryCorpus(
      this.memory,
      handoff.sessionId,
      handoff.query,
    );
    const allFilePaths = dedupe([
      ...searchResponse.hits.map((hit) => hit.filePath),
      ...(handoff.filePaths ?? []),
    ]);

    const fileSignals: FileSignals[] = allFilePaths.map((filePath) => {
      const hits = searchResponse.hits.filter(
        (hit) => hit.filePath === filePath,
      );
      return {
        filePath,
        previews: hits.map((hit) => hit.preview),
        searchScore: Math.max(...hits.map((hit) => hit.score), 0),
        hitCount: hits.length,
        fromHandoff: handoff.filePaths.includes(filePath),
      };
    });

    const rankedFiles = rankFileSignals(
      fileSignals,
      tokenize(handoff.query),
      handoff.domains,
      memoryCorpus,
    );
    const relevantFiles = rankedFiles.map((entry) => entry.filePath);
    const inferredDomains = inferDomainsFromFilePaths(relevantFiles);
    const domains = dedupe([...handoff.domains, ...inferredDomains]);

    const notes = dedupe([
      ...buildSearchNotes(searchResponse.totalCandidates, rankedFiles.length),
      ...buildMemoryNotes(memoryCorpus.length),
      ...(handoff.analysis?.notes ?? []),
    ]);

    const risks = dedupe(handoff.analysis?.risks ?? []);
    const summary =
      handoff.analysis?.summary ??
      `Scout found ${relevantFiles.length} relevant files for query: ${handoff.query}`;

    return {
      summary,
      relevantFiles,
      rankedFiles,
      domains,
      notes,
      risks,
    };
  }
}
