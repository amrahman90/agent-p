import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { SearchEngine } from "../../src/search/api.js";
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

describe("SearchEngine orchestration", () => {
  it("runs sanitize -> stage1 -> stage2 -> stage3 -> stage4 and returns response metadata", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-api-"));
    const srcDir = join(workspaceRoot, "src");
    mkdirSync(srcDir, { recursive: true });

    const stage = {
      searchSanitized: vi
        .fn<(request: SanitizedSearchRequest) => Promise<SearchHit[]>>()
        .mockResolvedValue([
          makeHit({
            filePath: "src/auth.ts",
            preview: "auth token token loaded",
          }),
          makeHit({
            filePath: "src/logger.ts",
            preview: "logger setup",
          }),
        ]),
    };

    const engine = new SearchEngine({ workspaceRoot, stage });
    const response = await engine.query({
      query: "  auth token  ",
      root: "src",
      limit: 5,
      mode: "literal",
    });

    expect(stage.searchSanitized).toHaveBeenCalledTimes(1);
    expect(stage.searchSanitized).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "auth token",
        resolvedRoot: resolve(srcDir),
        limit: 5,
        mode: "literal",
      }),
    );

    expect(response.query).toBe("auth token");
    expect(response.root).toBe(resolve(srcDir));
    expect(response.limit).toBe(5);
    expect(response.totalCandidates).toBe(2);
    expect(response.hits).toHaveLength(2);
    expect(response.hits[0]?.filePath).toBe("src/auth.ts");
    expect(response.hits[0]?.score).toBeGreaterThan(
      response.hits[1]?.score ?? 0,
    );
  });

  it("applies bm25 limit bounded by request limit", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-api-"));

    const stage = {
      searchSanitized: vi
        .fn()
        .mockResolvedValue([
          makeHit({ filePath: "src/a.ts", preview: "auth token token" }),
          makeHit({ filePath: "src/b.ts", preview: "auth token" }),
          makeHit({ filePath: "src/c.ts", preview: "auth" }),
        ]),
    };

    const engine = new SearchEngine({
      workspaceRoot,
      stage,
      bm25: { limit: 2 },
    });

    const response = await engine.query({ query: "auth token", limit: 3 });
    expect(response.hits).toHaveLength(2);
  });

  it("enforces sanitization limits before stage execution", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-api-"));
    const stage = {
      searchSanitized: vi.fn().mockResolvedValue([]),
    };

    const engine = new SearchEngine({ workspaceRoot, stage, maxLimit: 2 });

    await expect(engine.query({ query: "auth", limit: 3 })).rejects.toThrow(
      "search limit exceeds maximum of 2",
    );
    expect(stage.searchSanitized).not.toHaveBeenCalled();
  });

  it("applies deterministic tie-break ordering after BM25 + Jaccard blend", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-api-"));
    const stage = {
      searchSanitized: vi.fn().mockResolvedValue([
        makeHit({
          filePath: "src/a.ts",
          line: 10,
          column: 5,
          preview: "alpha token",
        }),
        makeHit({
          filePath: "src/b.ts",
          line: 2,
          column: 1,
          preview: "alpha token",
        }),
      ]),
    };

    const engine = new SearchEngine({
      workspaceRoot,
      stage,
      jaccard: {
        bm25Weight: 0,
        jaccardWeight: 1,
      },
    });

    const response = await engine.query({ query: "alpha token", limit: 2 });
    expect(response.hits.map((hit) => hit.filePath)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
