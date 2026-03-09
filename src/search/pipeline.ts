import { rankSearchHitsWithBm25, type Bm25RankingOptions } from "./bm25.js";
import { rerankWithJaccard, type JaccardRankingOptions } from "./jaccard.js";
import { sanitizeSearchRequest } from "./sanitize.js";
import { TreeSitterSearchStage, type TreeSitterStage } from "./tree-sitter.js";
import type {
  SanitizedSearchRequest,
  SearchHit,
  SearchRequest,
  SearchStageTimingMetadata,
} from "./types.js";

export interface SearchStage1 {
  searchSanitized(request: SanitizedSearchRequest): Promise<SearchHit[]>;
}

/**
 * Search Pipeline Options - Configuration for the multi-stage search pipeline
 *
 * @property workspaceRoot - Root directory of the workspace being searched
 * @property stage1 - Primary search stage (typically ripgrep)
 * @property stage2 - Optional tree-sitter based structural search
 * @property bm25 - BM25 ranking algorithm parameters
 * @property jaccard - Jaccard similarity reranking parameters
 * @property maxLimit - Maximum number of results to return
 * @property maxQueryLength - Maximum length of search query
 */
export interface SearchPipelineOptions {
  readonly workspaceRoot: string;
  readonly stage1: SearchStage1;
  readonly stage2?: TreeSitterStage;
  readonly bm25?: Bm25RankingOptions;
  readonly jaccard?: JaccardRankingOptions;
  readonly maxLimit?: number;
  readonly maxQueryLength?: number;
}

export interface SearchContext {
  readonly request: SearchRequest;
  readonly sanitized: SanitizedSearchRequest;
  readonly candidates: readonly SearchHit[];
  readonly hits: readonly SearchHit[];
  readonly metadata: {
    readonly stage: "complete";
    readonly stage2: {
      readonly available: boolean;
      readonly fallbackReason?: string;
    };
    readonly startedAt: number;
    readonly completedAt: number;
    readonly durationMs: number;
    readonly stageDurationsMs: SearchStageTimingMetadata;
  };
}

const resolveBm25Limit = (
  requestLimit: number,
  bm25Limit: number | undefined,
): number => {
  if (bm25Limit === undefined) {
    return requestLimit;
  }

  return Math.min(requestLimit, bm25Limit);
};

/**
 * Executes a multi-stage search pipeline with ranking and reranking
 *
 * @param request - The search request containing query and options
 * @param options - Pipeline configuration including stages and ranking options
 * @returns Search context with hits and timing metadata
 *
 * @remarks
 * The pipeline executes in 4 stages:
 * 1. **Stage 1 (Ripgrep)**: Initial text-based search using ripgrep
 * 2. **Stage 2 (Tree-sitter)**: Structural code analysis (optional, falls back if unavailable)
 * 3. **Stage 3 (BM25)**: Semantic ranking using Okapi BM25 algorithm
 * 4. **Stage 4 (Jaccard)**: Similarity-based reranking
 *
 * @example
 * ```typescript
 * const results = await runSearchPipeline(
 *   { query: 'function.*auth', limit: 20 },
 *   { workspaceRoot: '/project', stage1: ripgrepStage }
 * );
 * console.log(results.hits);
 * ```
 */
export const runSearchPipeline = async (
  request: SearchRequest,
  options: SearchPipelineOptions,
): Promise<SearchContext> => {
  const startedAt = Date.now();

  const sanitizeStartedAt = Date.now();
  const sanitized = sanitizeSearchRequest(request, options.workspaceRoot, {
    ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
    ...(options.maxQueryLength !== undefined
      ? { maxQueryLength: options.maxQueryLength }
      : {}),
  });
  const sanitizeDurationMs = Date.now() - sanitizeStartedAt;

  const stage1StartedAt = Date.now();
  const stage1Candidates = await options.stage1.searchSanitized(sanitized);
  const stage1DurationMs = Date.now() - stage1StartedAt;

  const stage2 = options.stage2 ?? new TreeSitterSearchStage();
  const stage2StartedAt = Date.now();
  const stage2Result = await stage2.searchSanitized(
    sanitized,
    stage1Candidates,
  );
  const stage2DurationMs = Date.now() - stage2StartedAt;

  const stage3StartedAt = Date.now();
  const stage3Hits = rankSearchHitsWithBm25(
    stage2Result.hits,
    sanitized.query,
    {
      ...options.bm25,
      limit: resolveBm25Limit(sanitized.limit, options.bm25?.limit),
    },
  );
  const stage3DurationMs = Date.now() - stage3StartedAt;

  const stage4StartedAt = Date.now();
  const hits = rerankWithJaccard(stage3Hits, sanitized.query, {
    ...options.jaccard,
    limit: resolveBm25Limit(sanitized.limit, options.jaccard?.limit),
  });
  const stage4DurationMs = Date.now() - stage4StartedAt;

  const completedAt = Date.now();

  return {
    request,
    sanitized,
    candidates: stage1Candidates,
    hits,
    metadata: {
      stage: "complete",
      stage2: {
        available: stage2Result.available,
        ...(stage2Result.fallbackReason !== undefined
          ? { fallbackReason: stage2Result.fallbackReason }
          : {}),
      },
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      stageDurationsMs: {
        sanitize: sanitizeDurationMs,
        stage1: stage1DurationMs,
        stage2: stage2DurationMs,
        stage3: stage3DurationMs,
        stage4: stage4DurationMs,
      },
    },
  };
};
