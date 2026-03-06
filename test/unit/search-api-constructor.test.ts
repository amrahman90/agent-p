import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SanitizedSearchRequest,
  SearchHit,
} from "../../src/search/types.js";

const ripgrepConstructorCalls: unknown[] = [];
const searchSanitizedMock = vi
  .fn<(request: SanitizedSearchRequest) => Promise<SearchHit[]>>()
  .mockResolvedValue([]);

vi.mock("../../src/search/ripgrep.js", () => {
  class MockRipgrepSearchStage {
    constructor(options: unknown) {
      ripgrepConstructorCalls.push(options);
    }

    async searchSanitized(
      request: SanitizedSearchRequest,
    ): Promise<SearchHit[]> {
      return searchSanitizedMock(request);
    }
  }

  return {
    RipgrepSearchStage: MockRipgrepSearchStage,
  };
});

import { SearchEngine } from "../../src/search/api.js";

describe("SearchEngine constructor wiring", () => {
  beforeEach(() => {
    ripgrepConstructorCalls.length = 0;
    searchSanitizedMock.mockClear();
  });

  it("forwards only defined ripgrep options when using default stage", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agent-p-search-api-ctor-"),
    );
    const srcDir = join(workspaceRoot, "src");
    mkdirSync(srcDir, { recursive: true });

    const spawnProcess = vi.fn();

    const engine = new SearchEngine({
      workspaceRoot,
      rgBinary: "custom-rg",
      spawnProcess,
      maxLimit: 7,
      maxQueryLength: 50,
    });

    await engine.query({
      query: "needle",
      root: "src",
      limit: 2,
      mode: "literal",
    });

    expect(ripgrepConstructorCalls).toHaveLength(1);
    expect(ripgrepConstructorCalls[0]).toEqual({
      workspaceRoot,
      rgBinary: "custom-rg",
      spawnProcess,
      maxLimit: 7,
      maxQueryLength: 50,
    });
    expect(searchSanitizedMock).toHaveBeenCalledTimes(1);
  });

  it("passes maxQueryLength into sanitization options", async () => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agent-p-search-api-ctor-"),
    );

    const engine = new SearchEngine({ workspaceRoot, maxQueryLength: 3 });

    await expect(engine.query({ query: "toolong" })).rejects.toThrow(
      "search query exceeds max length of 3",
    );
    expect(searchSanitizedMock).not.toHaveBeenCalled();
  });

  it("emits search telemetry on success and failure", async () => {
    const telemetryRecorder = {
      recordSearchRun: vi.fn(),
    };

    const successEngine = new SearchEngine({
      workspaceRoot: process.cwd(),
      telemetryRecorder,
      stage: {
        searchSanitized: vi.fn().mockResolvedValue([
          {
            filePath: "src/cli.ts",
            line: 1,
            column: 1,
            preview: "search",
            score: 1,
          },
        ]),
      },
    });

    await successEngine.query({
      sessionId: "session-search-1",
      query: "search",
      limit: 5,
    });

    const failingEngine = new SearchEngine({
      workspaceRoot: process.cwd(),
      telemetryRecorder,
      stage: {
        searchSanitized: vi
          .fn()
          .mockRejectedValue(new Error("ripgrep execution failed")),
      },
    });

    await expect(
      failingEngine.query({ sessionId: "session-search-1", query: "oops" }),
    ).rejects.toThrow("ripgrep execution failed");

    expect(telemetryRecorder.recordSearchRun).toHaveBeenCalledTimes(2);
    expect(telemetryRecorder.recordSearchRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-search-1",
        query: "search",
        provider: "ripgrep+bm25",
        resultCount: 1,
      }),
    );
    expect(telemetryRecorder.recordSearchRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: "session-search-1",
        query: "oops",
        resultCount: 0,
        error: "ripgrep execution failed",
      }),
    );
  });
});
