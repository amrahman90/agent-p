# Documentation Guide

This guide explains how to generate and maintain documentation for agent-p.

## Generating API Documentation

Generate the API reference using TypeDoc:

```bash
pnpm docs:api
```

This outputs to `docs/api/` as HTML files (default theme).

## Documentation Structure

```
docs/
├── api/                  # Generated API reference
├── architecture/         # Architecture decision records
├── guides/               # User guides
│   ├── documentation.md  # This file
│   ├── workflow.md       # Workflow guide
│   ├── testing.md        # Testing guide
│   ├── skills.md         # Skills guide
│   └── contributing.md   # Contributing guide
├── CHANGELOG.md          # Changelog
└── README.md             # Project readme
```

## Writing JSDoc

Add JSDoc comments to public APIs with `@example` tags:

```typescript
/**
 * Resolves a dependency from the container.
 * @param token - The dependency token to resolve
 * @returns The resolved dependency instance
 * @example
 * ```typescript
 * const instance = container.resolve(MyService);
 * ```
 */
export function resolve<T>(token: Token<T>): T
```

## Priority Files for Documentation

These files need JSDoc coverage:

1. `src/agents/types.ts` - Agent type definitions
2. `src/agents/expert.ts` - Expert agent implementation
3. `src/hooks/types.ts` - Hook system types
4. `src/hooks/policy.ts` - Hook policy engine
5. `src/telemetry/types.ts` - Telemetry types
6. `src/evals/types.ts` - Evaluation types
7. `src/workflow/executor.ts` - Workflow executor

## TypeDoc Configuration

See `typedoc.json` for configuration options:

- `entryPoints` - Entry points for documentation
- `out` - Output directory
- `theme` - Output format (markdown/json/html)
- `excludePrivate` - Hide private members
- `categorizeByGroup` - Group by @group tag
