import type { SanitizedSearchRequest, SearchHit } from "./types.js";

export interface TreeSitterStageResult {
  readonly hits: readonly SearchHit[];
  readonly available: boolean;
  readonly fallbackReason?: string;
}

export interface TreeSitterStage {
  searchSanitized(
    request: SanitizedSearchRequest,
    candidates: readonly SearchHit[],
  ): Promise<TreeSitterStageResult>;
}

interface StructuralSignal {
  readonly keywordsMatched: number;
  readonly lineWeight: number;
}

const AST_KEYWORDS = [
  "function",
  "class",
  "interface",
  "type",
  "import",
  "export",
  "const",
  "let",
  "async",
  "await",
] as const;

const tokenize = (value: string): Set<string> => {
  return new Set(value.toLowerCase().match(/[a-z0-9_]+/giu) ?? []);
};

const toSignal = (
  request: SanitizedSearchRequest,
  hit: SearchHit,
): StructuralSignal => {
  const queryTokens = tokenize(request.query);
  const previewTokens = tokenize(hit.preview);
  let keywordsMatched = 0;

  for (const token of AST_KEYWORDS) {
    if (queryTokens.has(token) && previewTokens.has(token)) {
      keywordsMatched += 1;
    }
  }

  return {
    keywordsMatched,
    lineWeight: hit.line <= 80 ? 1 : 0.9,
  };
};

const applySignalBoost = (
  hit: SearchHit,
  signal: StructuralSignal,
): SearchHit => {
  const boost = signal.keywordsMatched * 0.05 + (signal.lineWeight - 0.9);
  return {
    ...hit,
    score: Math.max(0, hit.score + boost),
  };
};

/**
 * Stage 2 best-effort structural pass.
 *
 * This stage keeps deterministic behavior even when parser assets are missing.
 * In fallback mode, it derives lightweight structure signals directly from text.
 */
export class TreeSitterSearchStage implements TreeSitterStage {
  async searchSanitized(
    request: SanitizedSearchRequest,
    candidates: readonly SearchHit[],
  ): Promise<TreeSitterStageResult> {
    const enriched = candidates.map((hit) =>
      applySignalBoost(hit, toSignal(request, hit)),
    );

    return {
      hits: enriched,
      available: false,
      fallbackReason: "grammar assets unavailable; structural fallback applied",
    };
  }
}
