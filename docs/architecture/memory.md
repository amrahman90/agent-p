# Memory Module Documentation (Phase 2)

## Goal

Implement scoped memory primitives with a deterministic hot -> warm -> cold retrieval strategy, scoped isolation, and promotion semantics.

## Step-by-step modules

### 1) Data model and contracts

- `src/memory/types.ts`
  - defines `MemoryEntry`, scopes, temperature, and query option contracts
- `src/memory/schema.ts`
  - defines Drizzle `memory_entries` schema + indexes (`idx_memory_scope`, `uq_memory_scope_key`)

### 2) Hot tier (fast path)

- `src/memory/tiered/hot.ts`
  - LRU cache based on `lru-cache`
  - TTL + max entries + max size controls
  - supports `upsert/get/delete/list/search/clearScope/clearAll`
  - updates access metadata (`accessCount`, `lastAccessedAt`) on reads

### 3) Warm + cold tier adapters

- `src/memory/tiered/warm.ts`
  - warm adapter over `SqliteMemoryStore` primitives
  - preserves scoped read/write/search/delete/list/clear APIs
  - supports bounded warm search result caps
- `src/memory/tiered/cold.ts`
  - JSONL archive adapter with deterministic record ordering
  - supports scoped read/write/search/delete/list/clear APIs
  - enforces archive entry cap (`maxEntries`)

### 4) SQLite memory store (warm path primitives)

- `src/memory/store.ts`
  - initializes `memory_entries` table and indexes
  - tries to create FTS5 virtual table + triggers
  - falls back to LIKE search when FTS5 is unavailable
  - supports upsert/get/delete/list/search/clearAll

### 5) Scope API

- `src/memory/scopes/scope-store.ts`
  - reusable scoped API (`set/save/add/get/load/delete/list/search/clear`)
  - validates scope and key inputs
- `src/memory/scopes/session.ts`
- `src/memory/scopes/user.ts`
- `src/memory/scopes/shared.ts`
- `src/memory/scopes/private.ts`

### 6) Memory manager facade

- `src/memory/manager.ts`
  - exposes `session`, `user`, `shared`, and dynamic `privateScope(agentId)`
  - centralizes hot/warm/cold policy defaults and bounded knobs
  - deterministic lookup chain: `hot -> warm -> cold`
  - deterministic promotion chain:
    - warm hit promotes into hot
    - cold hit promotes into warm + hot
  - provides scoped query helpers (`searchSession`) and diagnostics helpers (`searchAll`, `listAll`, `clearAll`)

### 7) Validation and exports

- `src/memory/validation.ts`
  - non-empty validation for scope IDs, keys, and agent IDs
- `src/memory/index.ts`
  - module export surface

## Security and isolation choices

- strict scope-based key partitioning (`scope + scopeId + key`) across all tiers.
- input normalization and non-empty checks for IDs/keys.
- parameterized SQL path via `sqlQuery` helper from DB safety layer.
- scout-facing retrievals should use explicit scoped queries (session-bound) instead of cross-scope scans.

## Related tests

- `test/unit/memory.test.ts`
- `test/unit/memory-store.test.ts`
- `test/unit/migration-runner.test.ts`
- `test/unit/sql-safety.test.ts`
