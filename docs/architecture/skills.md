# Skills Module Documentation (Phase 4)

## Goal

Provide deterministic skill discovery and manual loading through a validated manifest, registry-backed runtime APIs, permission-aware filtering, and CLI integration.

## Step-by-step modules

### 1) Manifest contracts and metadata source

- `src/skills/schema.ts`
  - defines `SkillDefinition` and `SkillManifest` contracts via Zod
  - constrains activation (`auto` or `manual`), priority, and context load levels
  - defines optional permissions (`permissions.allowedAgents`) for agent-aware activation
- `src/skills/skills.json`
  - source-of-truth manifest stored in source tree
  - currently contains a curated 5-skill Phase 8B trial set (5/40 expansion)

### 2) Manifest loading and path resolution

- `src/skills/loader.ts`
  - resolves manifest path from `src/skills/skills.json`
  - falls back to `dist/src/skills/skills.json` at runtime
  - parses JSON + schema validation + semantic validation
  - supports `triggerSources` hydration before schema parse:
    - `triggerSources.frontmatterPath` reads `SKILL.md` frontmatter
    - `triggerSources.triggersPath` reads legacy `triggers.json`
    - paths are resolved relative to the manifest directory (not repo root)
  - trigger precedence is deterministic:
    1. manifest `triggers` (when present and non-empty)
    2. frontmatter triggers (`keywords`, `intentPatterns`, `filePatterns`, `contentPatterns`)
    3. legacy `triggers.json` fallback
  - when manifest values are absent, `activation`, `priority`, and `contextLoad` can be hydrated from frontmatter or legacy fallback
  - sanitizes loaded content by removing control characters and ANSI fragments, normalizing whitespace, and deduplicating string arrays case-insensitively
  - throws `SkillManifestValidationError` with actionable error context

### 3) Semantic validator

- `src/skills/validator.ts`
  - validates duplicate skill IDs across manifest
  - validates duplicate trigger values inside each skill
  - enforces trigger hygiene rules (non-empty, bounded length, no control chars)
  - validates allowlist hygiene for `permissions.allowedAgents`

### 4) Registry and activation APIs

- `src/skills/registry.ts`
  - stores skills in-memory by ID
  - provides lookup (`get`, `has`), listing, and domain filtering
  - exposes `fromManifest` factory
- `src/skills/activation.ts`
  - `suggestSkills` / `suggest_skills` for ranking by query, file path, domain, and priority
  - sanitizes request query and file path inputs before trigger matching
  - suggestion request accepts optional `agentId` context
  - disallowed skills are filtered deterministically via `permissions.allowedAgents`
  - `loadSkill` / `load_skill` for explicit manual loading by skill ID
  - load requests accept optional `agentId` and reject disallowed loads
  - wildcard path trigger support (`*`, `?`) and cross-platform path normalization
  - `SkillActivator` facade (`suggest`, `activate`, `load`)

### 5) Runtime composition and CLI integration

- `src/core/bootstrap.ts`
  - loads + validates manifest and registers skills services in DI container
- `src/cli.ts`
  - resolves `SkillActivator` and `SkillRegistry` from container
  - exposes:
    - `skills:suggest <query>`
    - `skills:load <skillId>`
  - supports optional `--agent <agentId>` on suggest/load commands

### 6) Build output asset handling

- `bin/copy-skills-manifest.ts`
  - copies `src/skills/skills.json` to `dist/src/skills/skills.json`
- `package.json`
  - `build` runs `build:check`, `build:compile`, and `build:assets`
  - `build:assets` ensures runtime manifest presence in `dist`

## Security and correctness choices

- strict schema and semantic validation before manifest use
- no dynamic code execution from skill metadata
- deterministic sort + score strategy for reproducible suggestions
- manual-only skills excluded by default unless explicitly requested
- permission-aware filtering prevents disallowed skill activation for agent context

## Related tests

- `test/unit/skills-loader.test.ts`
- `test/unit/skills-validator.test.ts`
- `test/unit/skills-activation.test.ts`
- `test/unit/skills-load.test.ts`
- `test/unit/container.test.ts`
