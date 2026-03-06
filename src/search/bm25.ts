import type { SearchHit } from "./types.js";

export const DEFAULT_BM25_K1 = 1.2;
export const DEFAULT_BM25_B = 0.75;

export interface Bm25RankingOptions {
  readonly k1?: number;
  readonly b?: number;
  readonly limit?: number;
}

interface PreparedDocument {
  readonly hit: SearchHit;
  readonly originalIndex: number;
  readonly length: number;
  readonly termFrequencies: ReadonlyMap<string, number>;
}

interface ScoredDocument {
  readonly hit: SearchHit;
  readonly originalIndex: number;
}

const TOKEN_PATTERN = /[a-z0-9_]+/giu;

export const tokenizeForBm25 = (value: string): readonly string[] => {
  const normalized = value.toLowerCase();
  return normalized.match(TOKEN_PATTERN) ?? [];
};

const buildTermFrequencies = (
  tokens: readonly string[],
): Map<string, number> => {
  const frequencies = new Map<string, number>();

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  return frequencies;
};

const validateBm25Options = (
  options: Bm25RankingOptions,
): {
  readonly k1: number;
  readonly b: number;
  readonly limit?: number;
} => {
  const k1 = options.k1 ?? DEFAULT_BM25_K1;
  if (!Number.isFinite(k1) || k1 <= 0) {
    throw new Error("k1 must be a positive finite number");
  }

  const b = options.b ?? DEFAULT_BM25_B;
  if (!Number.isFinite(b) || b < 0 || b > 1) {
    throw new Error("b must be a finite number between 0 and 1");
  }

  const limit = options.limit;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || !Number.isFinite(limit) || limit <= 0)
  ) {
    throw new Error("bm25 limit must be a positive integer when provided");
  }

  if (limit === undefined) {
    return { k1, b };
  }

  return { k1, b, limit };
};

const prepareDocument = (
  hit: SearchHit,
  originalIndex: number,
): PreparedDocument => {
  const tokens = tokenizeForBm25(`${hit.filePath} ${hit.preview}`);

  return {
    hit,
    originalIndex,
    length: Math.max(tokens.length, 1),
    termFrequencies: buildTermFrequencies(tokens),
  };
};

const compareHits = (left: SearchHit, right: SearchHit): number => {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.filePath !== right.filePath) {
    return left.filePath < right.filePath ? -1 : 1;
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.column - right.column;
};

const bm25Idf = (
  documentCount: number,
  containingDocuments: number,
): number => {
  return Math.log(
    1 +
      (documentCount - containingDocuments + 0.5) / (containingDocuments + 0.5),
  );
};

/**
 * Scores Stage 1 candidates with BM25 and returns hits sorted by relevance.
 */
export const rankSearchHitsWithBm25 = (
  hits: readonly SearchHit[],
  query: string,
  options: Bm25RankingOptions = {},
): SearchHit[] => {
  if (hits.length === 0) {
    return [];
  }

  const normalized = validateBm25Options(options);
  const limit = normalized.limit ?? hits.length;
  const preparedDocuments = hits.map((hit, index) =>
    prepareDocument(hit, index),
  );

  const averageLength =
    preparedDocuments.reduce((total, document) => total + document.length, 0) /
    preparedDocuments.length;

  const queryTerms = tokenizeForBm25(query);
  if (queryTerms.length === 0) {
    return preparedDocuments
      .map((document) => ({
        hit: { ...document.hit, score: 0 },
        originalIndex: document.originalIndex,
      }))
      .sort((left, right) => {
        const comparison = compareHits(left.hit, right.hit);
        if (comparison !== 0) {
          return comparison;
        }

        return left.originalIndex - right.originalIndex;
      })
      .slice(0, limit)
      .map((document) => document.hit);
  }

  const uniqueQueryTerms = [...new Set(queryTerms)];
  const documentFrequency = new Map<string, number>();

  for (const term of uniqueQueryTerms) {
    let containsTerm = 0;
    for (const document of preparedDocuments) {
      if ((document.termFrequencies.get(term) ?? 0) > 0) {
        containsTerm += 1;
      }
    }

    if (containsTerm > 0) {
      documentFrequency.set(term, containsTerm);
    }
  }

  return preparedDocuments
    .map((document): ScoredDocument => {
      const docLength = document.length;
      let score = 0;

      for (const term of uniqueQueryTerms) {
        const termFrequency = document.termFrequencies.get(term) ?? 0;
        if (termFrequency === 0) {
          continue;
        }

        const containingDocuments = documentFrequency.get(term);
        if (!containingDocuments) {
          continue;
        }

        const idf = bm25Idf(preparedDocuments.length, containingDocuments);
        const numerator = termFrequency * (normalized.k1 + 1);
        const denominator =
          termFrequency +
          normalized.k1 *
            (1 - normalized.b + normalized.b * (docLength / averageLength));

        score += idf * (numerator / denominator);
      }

      return {
        originalIndex: document.originalIndex,
        hit: {
          ...document.hit,
          score,
        },
      };
    })
    .sort((left, right) => {
      const comparison = compareHits(left.hit, right.hit);
      if (comparison !== 0) {
        return comparison;
      }

      return left.originalIndex - right.originalIndex;
    })
    .slice(0, limit)
    .map((document) => document.hit);
};
