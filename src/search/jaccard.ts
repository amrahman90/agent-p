import type { SearchHit } from "./types.js";

const TOKEN_PATTERN = /[a-z0-9_]+/giu;

export interface JaccardRankingOptions {
  readonly bm25Weight?: number;
  readonly jaccardWeight?: number;
  readonly limit?: number;
}

const DEFAULT_BM25_WEIGHT = 0.8;
const DEFAULT_JACCARD_WEIGHT = 0.2;

const tokenize = (value: string): Set<string> => {
  return new Set(value.toLowerCase().match(TOKEN_PATTERN) ?? []);
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
};

const compareHits = (left: SearchHit, right: SearchHit): number => {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.filePath !== right.filePath) {
    return left.filePath.localeCompare(right.filePath);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.column - right.column;
};

const normalizeWeight = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }

  return value;
};

const normalizeLimit = (limit: number | undefined): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("jaccard limit must be a positive integer when provided");
  }

  return limit;
};

/**
 * Stage 4 reranking with deterministic BM25 + Jaccard blending.
 */
export const rerankWithJaccard = (
  hits: readonly SearchHit[],
  query: string,
  options: JaccardRankingOptions = {},
): SearchHit[] => {
  if (hits.length === 0) {
    return [];
  }

  const bm25Weight = normalizeWeight(
    options.bm25Weight ?? DEFAULT_BM25_WEIGHT,
    "bm25Weight",
  );
  const jaccardWeight = normalizeWeight(
    options.jaccardWeight ?? DEFAULT_JACCARD_WEIGHT,
    "jaccardWeight",
  );
  if (bm25Weight + jaccardWeight === 0) {
    throw new Error("bm25Weight and jaccardWeight cannot both be zero");
  }

  const limit = normalizeLimit(options.limit) ?? hits.length;
  const queryTokens = tokenize(query);

  return hits
    .map((hit, index) => {
      const hitTokens = tokenize(`${hit.filePath} ${hit.preview}`);
      const jaccard = jaccardSimilarity(queryTokens, hitTokens);

      return {
        index,
        hit: {
          ...hit,
          score: hit.score * bm25Weight + jaccard * jaccardWeight,
        },
      };
    })
    .sort((left, right) => {
      const comparison = compareHits(left.hit, right.hit);
      if (comparison !== 0) {
        return comparison;
      }

      return left.index - right.index;
    })
    .slice(0, limit)
    .map((entry) => entry.hit);
};
