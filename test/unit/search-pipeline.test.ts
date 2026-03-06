import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runSearchPipeline } from "../../src/search/pipeline.js";
import type {
  SanitizedSearchRequest,
  SearchHit,
} from "../../src/search/types.js";

const makeHit = (overrides: Partial<SearchHit>): SearchHit => {
  return {
    filePath: overrides.filePath ?? "src/example.ts",
    line: overrides.line ?? 1,
    column: overrides.column ?? 1,
    preview: overrides.preview ?? "",
    score: overrides.score ?? 0,
  };
};

describe("runSearchPipeline", () => {
  it("returns explicit SearchContext across sanitize, stage, and ranking", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agent-p-search-pipeline-"),
    );
    const srcDir = join(workspaceRoot, "src");
    mkdirSync(srcDir, { recursive: true });

    const searchSanitized = vi
      .fn<(request: SanitizedSearchRequest) => Promise<SearchHit[]>>()
      .mockResolvedValue([
        makeHit({ filePath: "src/auth.ts", preview: "auth token token" }),
        makeHit({ filePath: "src/logger.ts", preview: "logger" }),
      ]);

    const context = await runSearchPipeline(
      {
        query: "  auth token  ",
        root: "src",
        limit: 5,
      },
      {
        workspaceRoot,
        stage1: {
          searchSanitized,
        },
      },
    );

    expect(searchSanitized).toHaveBeenCalledTimes(1);
    expect(searchSanitized).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "auth token",
        resolvedRoot: resolve(srcDir),
        limit: 5,
      }),
    );

    expect(context.sanitized.query).toBe("auth token");
    expect(context.sanitized.resolvedRoot).toBe(resolve(srcDir));
    expect(context.candidates).toHaveLength(2);
    expect(context.hits).toHaveLength(2);
    expect(context.hits[0]?.filePath).toBe("src/auth.ts");
    expect(context.metadata.stage).toBe("complete");
    expect(context.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(context.metadata.stageDurationsMs.sanitize).toBeGreaterThanOrEqual(
      0,
    );
    expect(context.metadata.stageDurationsMs.stage1).toBeGreaterThanOrEqual(0);
    expect(context.metadata.stageDurationsMs.stage2).toBeGreaterThanOrEqual(0);
    expect(context.metadata.stageDurationsMs.stage3).toBeGreaterThanOrEqual(0);
    expect(context.metadata.stageDurationsMs.stage4).toBeGreaterThanOrEqual(0);
    expect(context.metadata.stage2.available).toBe(false);
    expect(context.metadata.stage2.fallbackReason).toContain("fallback");
  });

  it("bounds bm25 output using request limit and bm25 limit", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agent-p-search-pipeline-"),
    );

    const context = await runSearchPipeline(
      {
        query: "auth token",
        limit: 3,
      },
      {
        workspaceRoot,
        bm25: { limit: 2 },
        stage1: {
          searchSanitized: vi
            .fn()
            .mockResolvedValue([
              makeHit({ filePath: "src/a.ts", preview: "auth token token" }),
              makeHit({ filePath: "src/b.ts", preview: "auth token" }),
              makeHit({ filePath: "src/c.ts", preview: "auth" }),
            ]),
        },
      },
    );

    expect(context.candidates).toHaveLength(3);
    expect(context.hits).toHaveLength(2);
  });

  it("supports explicit stage2 fallback metadata", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agent-p-search-pipeline-"),
    );

    const context = await runSearchPipeline(
      {
        query: "auth token",
        limit: 2,
      },
      {
        workspaceRoot,
        stage1: {
          searchSanitized: vi
            .fn()
            .mockResolvedValue([
              makeHit({ filePath: "src/a.ts", preview: "auth token token" }),
            ]),
        },
        stage2: {
          searchSanitized: vi.fn().mockResolvedValue({
            hits: [
              makeHit({ filePath: "src/a.ts", preview: "auth token token" }),
            ],
            available: false,
            fallbackReason: "grammar assets unavailable",
          }),
        },
      },
    );

    expect(context.metadata.stage2.available).toBe(false);
    expect(context.metadata.stage2.fallbackReason).toBe(
      "grammar assets unavailable",
    );
  });
});
