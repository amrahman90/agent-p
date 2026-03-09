# Search Module Documentation (Phase 3 - Active 4-Stage)

## Goal

Implement a secure, production-safe four-stage search pipeline with request sanitization, ripgrep retrieval, best-effort Tree-sitter structural analysis, BM25 ranking, and Jaccard reranking.

## Step-by-step modules

### 1) Search contracts

- `src/search/types.ts`
  - `SearchRequest`
  - `SanitizedSearchRequest`
  - `SearchHit`
  - `SearchMode` (`literal` | `regex`)

### 2) Input sanitization and path safety

- `src/search/sanitize.ts`
  - `sanitizeSearchQuery` (trim, non-empty, null-byte block, max length)
  - `sanitizeSearchLimit` (positive integer + max bound)
  - `sanitizeRegexFlags` (allowlist: `i/m/s/u`; regex-mode only)
  - `resolveSearchRoot` (realpath + workspace boundary enforcement)
  - `sanitizeSearchRequest` (single validated request shape)

### 3) Ripgrep Stage 1 execution

- `src/search/ripgrep.ts`
  - `buildRipgrepArgs` creates explicit argument arrays
  - `RipgrepSearchStage.search` executes `rg` without shell interpolation
  - `RipgrepSearchStage.searchSanitized` executes Stage 1 from validated request input
  - `parseRipgrepJsonLine` / `parseRipgrepJsonOutput` parse JSON events and keep `match` rows only

### 4) Tree-sitter Stage 2 (best-effort)

- `src/search/tree-sitter.ts`
  - explicit Stage 2 interface (`TreeSitterStage`)
  - deterministic stage output shape (`hits`, `available`, optional `fallbackReason`)
  - graceful fallback path when parser/grammar assets are unavailable

### 5) BM25 Stage 3 ranking

- `src/search/bm25.ts`
  - `tokenizeForBm25` normalizes query/document tokens
  - `rankSearchHitsWithBm25` scores candidates and sorts with deterministic tie-breakers
  - supports validated BM25 options (`k1`, `b`, optional `limit`)

### 6) Jaccard Stage 4 reranking

- `src/search/jaccard.ts`
  - deterministic Jaccard similarity scoring
  - BM25 + Jaccard score blending with bounded weights
  - stable tie-break ordering for equal scores

### 7) Search API orchestration

- `src/search/api.ts`
  - `SearchEngine.query` delegates orchestration to `runSearchPipeline(...)`
  - response contract `SearchResponse`: query/root/mode/limit/totalCandidates/hits
  - BM25 output limit is clamped to `min(request.limit, bm25.limit)` when BM25 limit is configured
  - constructor forwards only defined ripgrep options into default `RipgrepSearchStage` wiring
  - sanitization options are forwarded from engine-level limits before stage execution
- `src/search/pipeline.ts`
  - explicit `SearchContext` contract for sanitize -> stage1 -> stage2 -> stage3 -> stage4 flow
  - records per-stage durations (`sanitize`, `stage1`, `stage2`, `stage3`, `stage4`)
  - includes stage2 fallback metadata without changing `SearchResponse` public contract

### 8) Module exports

- `src/search/index.ts`
  - exports sanitization helpers, ripgrep stage, BM25 helpers, SearchEngine, and search types
- `src/index.ts`
  - re-exports search module at package root

## Security controls in current implementation

- no command-string shell execution for Stage 1.
- workspace confinement for requested root path.
- conflict validation: `caseSensitive=true` cannot combine with regex `i` flag.
- controlled defaults for query length and result limit.
- orchestration reuses sanitized request shape before stage execution.
- stage2 fallback remains deterministic and non-fatal when grammar assets are missing.

## Tests

- `test/unit/search-sanitization.test.ts`
- `test/unit/ripgrep-stage.test.ts`
- `test/unit/bm25.test.ts`
- `test/unit/search-pipeline.test.ts`
- `test/unit/search-orchestration.test.ts`
- `test/unit/search-api-constructor.test.ts`

## Status

- Stage 2 and Stage 4 are active in the pipeline.
- Stage 2 runs in best-effort mode and reports fallback metadata when structural parsing is unavailable.
