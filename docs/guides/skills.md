# Skills Guide

## Goal

Document skill catalog behavior, activation flow, and maintenance conventions.

## Current scope

- Skills are loaded from `src/skills/skills.json` and validated at runtime.
- Activation supports trigger-based suggestion and explicit loading paths.
- Permission-aware filtering is supported with optional agent context (`--agent`).
- Current implementation scope uses a curated 5-skill trial set; large-scale expansion remains tracked separately in `BUILD.md`.

## Trigger source resolution

- Primary trigger source is manifest-level `triggers` in `src/skills/skills.json`.
- Optional `triggerSources.frontmatterPath` can point to a `SKILL.md` file for metadata hydration.
- Optional `triggerSources.triggersPath` can point to a legacy `triggers.json` fallback.
- Precedence is deterministic:
  1. manifest `triggers` (if non-empty)
  2. frontmatter trigger lists
  3. legacy `triggers.json`
- `triggerSources` paths are resolved relative to the manifest directory (`src/skills`), not relative to repository root.

## Sanitization behavior

- Loader sanitizes metadata text and trigger/domain arrays by stripping control characters and ANSI fragments.
- Loader normalizes whitespace and deduplicates trigger/domain values case-insensitively.
- Activation sanitizes query and file path inputs before matching, so noisy input cannot bypass deterministic trigger checks.

## Operational commands

```bash
pnpm build
node bin/cli.js skills:suggest "query text"
node bin/cli.js skills:suggest "query text" --agent builder
node bin/cli.js skills:load <skill-id>
node bin/cli.js skills:load <skill-id> --agent reviewer
```

## Authoring conventions

- Keep skill identifiers stable and URL/path-safe.
- Prefer specific triggers over broad wildcard patterns.
- Include concise descriptions focused on when a skill should be used.
- Use `permissions.allowedAgents` for skills that must be restricted to specific agents.
- Avoid embedding secrets or environment-specific tokens in skill content.

## Validation and tests

- Unit coverage exists for loader/validator/activation flows in `test/unit/skills-*.test.ts`.
- CLI contract coverage for skill commands is included in `test/unit/cli.test.ts`.

## Maintenance checklist

1. Update skill metadata.
2. Validate trigger precedence behavior when `triggerSources` are changed.
3. Validate activation impact with unit tests.
4. Re-run `pnpm verify:phase9`.
5. Update `BUILD.md` and `KNOWLEDGE.md` when scope/status changes.
