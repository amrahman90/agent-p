import { RipgrepSearchStage, type RipgrepStageOptions } from "./ripgrep.js";
import {
  runSearchPipeline,
  type SearchContext,
  type SearchPipelineOptions,
  type SearchStage1,
} from "./pipeline.js";
import type { Bm25RankingOptions } from "./bm25.js";
import type { JaccardRankingOptions } from "./jaccard.js";
import type { TreeSitterStage } from "./tree-sitter.js";
import type { SearchRequest, SearchResponse } from "./types.js";

export interface SearchTelemetryRecorder {
  recordSearchRun(input: {
    sessionId: string;
    query: string;
    provider: string;
    durationMs: number;
    resultCount: number;
    error?: string;
  }): void;
}

export interface SearchEngineOptions extends RipgrepStageOptions {
  readonly bm25?: Bm25RankingOptions;
  readonly jaccard?: JaccardRankingOptions;
  readonly stage?: SearchStage1;
  readonly stage1?: SearchStage1;
  readonly stage2?: TreeSitterStage;
  readonly provider?: string;
  readonly telemetryRecorder?: SearchTelemetryRecorder;
}

/**
 * Search API orchestrator for Phase 3: sanitize -> ripgrep -> BM25 ranking.
 */
export class SearchEngine {
  private readonly stage1: SearchStage1;

  constructor(private readonly options: SearchEngineOptions) {
    const ripgrepOptions: RipgrepStageOptions = {
      workspaceRoot: options.workspaceRoot,
      ...(options.rgBinary !== undefined ? { rgBinary: options.rgBinary } : {}),
      ...(options.spawnProcess !== undefined
        ? { spawnProcess: options.spawnProcess }
        : {}),
      ...(options.maxQueryLength !== undefined
        ? { maxQueryLength: options.maxQueryLength }
        : {}),
      ...(options.maxLimit !== undefined ? { maxLimit: options.maxLimit } : {}),
    };

    this.stage1 =
      options.stage1 ?? options.stage ?? new RipgrepSearchStage(ripgrepOptions);
  }

  async query(request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    const provider = this.options.provider ?? "ripgrep+bm25";

    try {
      const context: SearchContext = await runSearchPipeline(
        request,
        this.resolvePipelineOptions(),
      );

      if (request.sessionId !== undefined) {
        this.options.telemetryRecorder?.recordSearchRun({
          sessionId: request.sessionId,
          query: context.sanitized.query,
          provider,
          durationMs: Date.now() - startedAt,
          resultCount: context.hits.length,
        });
      }

      return {
        query: context.sanitized.query,
        root: context.sanitized.resolvedRoot,
        mode: context.sanitized.mode,
        limit: context.sanitized.limit,
        totalCandidates: context.candidates.length,
        hits: context.hits,
      };
    } catch (error) {
      if (request.sessionId !== undefined) {
        this.options.telemetryRecorder?.recordSearchRun({
          sessionId: request.sessionId,
          query: request.query,
          provider,
          durationMs: Date.now() - startedAt,
          resultCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  private resolvePipelineOptions(): SearchPipelineOptions {
    return {
      workspaceRoot: this.options.workspaceRoot,
      stage1: this.stage1,
      ...(this.options.stage2 !== undefined
        ? { stage2: this.options.stage2 }
        : {}),
      ...(this.options.bm25 !== undefined ? { bm25: this.options.bm25 } : {}),
      ...(this.options.jaccard !== undefined
        ? { jaccard: this.options.jaccard }
        : {}),
      ...(this.options.maxLimit !== undefined
        ? { maxLimit: this.options.maxLimit }
        : {}),
      ...(this.options.maxQueryLength !== undefined
        ? { maxQueryLength: this.options.maxQueryLength }
        : {}),
    };
  }
}
