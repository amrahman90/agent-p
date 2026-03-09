# Search Module Deep Dive (Phase 3)

Canonical architecture status is maintained in `docs/architecture/search.md`.

## Scope

Current implementation covers:

- Stage 1: Ripgrep adapter (`src/search/ripgrep.ts`)
- Search input sanitization (`src/search/sanitize.ts`)
- Path traversal prevention for search roots

## API Surface

- `sanitizeSearchRequest(request, workspaceRoot, options?)`
  - Validates query, limit, mode, regex flags, and root path.
  - Resolves search root to an absolute path confined to workspace.
- `buildRipgrepArgs(sanitizedRequest)`
  - Generates explicit `rg` argument array.
- `RipgrepSearchStage.search(request)`
  - Runs ripgrep with sanitized input and returns normalized `SearchHit[]`.

## Security Controls

### Query sanitization

- Reject empty queries.
- Reject null bytes.
- Enforce maximum query length (default: 256).

### Limit sanitization

- Require positive integer.
- Enforce upper bound (default max: 500).

### Path traversal prevention

- Resolve workspace and candidate roots with `realpath`.
- Reject roots outside workspace boundary.
- Reject non-directory roots.

### Regex safety

- Regex flags accepted only in `mode: "regex"`.
- Allowed flags: `i`, `m`, `s`, `u`.
- Reject conflicting options (`caseSensitive=true` + `i`).

## Ripgrep execution contract

- Uses `spawn(command, args, { cwd })` with argument array.
- Does not construct shell command strings.
- Uses ripgrep JSON mode (`--json`) and parses only `match` events.
- Exit codes:
  - `0`: matches found
  - `1`: no matches (not treated as error)
  - other: treated as failure

## Result shape

Each match is normalized to:

- `filePath`
- `line` (1-based)
- `column` (1-based)
- `preview` (single-line excerpt)
- `score` (placeholder `0`; BM25 will set this later)

## Tests

- `test/unit/search-sanitization.test.ts`
  - query and limit validation
  - traversal blocking
  - regex flag validation
- `test/unit/ripgrep-stage.test.ts`
  - arg construction
  - JSON parsing
  - spawn-based stage behavior
