export type SearchMode = "literal" | "regex";

export interface SearchRequest {
  readonly sessionId?: string;
  readonly query: string;
  readonly root?: string;
  readonly limit?: number;
  readonly mode?: SearchMode;
  readonly regexFlags?: string;
  readonly caseSensitive?: boolean;
  readonly includeHidden?: boolean;
}

export interface SanitizedSearchRequest {
  readonly query: string;
  readonly resolvedRoot: string;
  readonly limit: number;
  readonly mode: SearchMode;
  readonly regexFlags: string;
  readonly caseSensitive: boolean;
  readonly includeHidden: boolean;
}

export interface SearchHit {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
  readonly score: number;
}

export interface SearchResponse {
  readonly query: string;
  readonly root: string;
  readonly mode: SearchMode;
  readonly limit: number;
  readonly totalCandidates: number;
  readonly hits: readonly SearchHit[];
}

export interface SearchStageTimingMetadata {
  readonly sanitize: number;
  readonly stage1: number;
  readonly stage2: number;
  readonly stage3: number;
  readonly stage4: number;
}
