import { describe, expect, it } from "vitest";

import {
  rankSearchHitsWithBm25,
  tokenizeForBm25,
} from "../../src/search/bm25.js";
import type { SearchHit } from "../../src/search/types.js";

const makeHit = (overrides: Partial<SearchHit>): SearchHit => {
  return {
    filePath: overrides.filePath ?? "src/example.ts",
    line: overrides.line ?? 1,
    column: overrides.column ?? 1,
    preview: overrides.preview ?? "",
    score: overrides.score ?? 0,
  };
};

describe("BM25 ranking", () => {
  it("ranks stronger lexical matches above weaker candidates", () => {
    const hits: SearchHit[] = [
      makeHit({
        filePath: "src/auth.ts",
        line: 10,
        preview: "auth token token loaded from secure config",
      }),
      makeHit({
        filePath: "src/session.ts",
        line: 8,
        preview: "auth middleware validates session cookie",
      }),
      makeHit({
        filePath: "src/logger.ts",
        line: 2,
        preview: "structured logger formatter",
      }),
    ];

    const ranked = rankSearchHitsWithBm25(hits, "auth token");

    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.filePath).toBe("src/auth.ts");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[1]?.score).toBeGreaterThan(ranked[2]?.score ?? 0);
  });

  it("uses deterministic tie-breaking for equal scores", () => {
    const hits: SearchHit[] = [
      makeHit({ filePath: "src/zeta.ts", line: 3, preview: "needle" }),
      makeHit({ filePath: "src/alpha.ts", line: 8, preview: "needle" }),
      makeHit({ filePath: "src/beta.ts", line: 1, preview: "needle" }),
    ];

    const ranked = rankSearchHitsWithBm25(hits, "needle");

    expect(ranked.map((hit) => hit.filePath)).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
      "src/zeta.ts",
    ]);
  });

  it("enforces optional limit", () => {
    const hits: SearchHit[] = [
      makeHit({ filePath: "src/a.ts", preview: "auth token token" }),
      makeHit({ filePath: "src/b.ts", preview: "auth token" }),
      makeHit({ filePath: "src/c.ts", preview: "auth" }),
    ];

    const ranked = rankSearchHitsWithBm25(hits, "auth token", { limit: 2 });

    expect(ranked).toHaveLength(2);
  });

  it("tokenizes mixed punctuation and case", () => {
    expect(tokenizeForBm25("Auth-Token::LOAD_user")).toEqual([
      "auth",
      "token",
      "load_user",
    ]);
  });

  it("throws for invalid bm25 options", () => {
    const hits = [makeHit({ preview: "auth token" })];

    expect(() => rankSearchHitsWithBm25(hits, "auth", { k1: 0 })).toThrow(
      "k1 must be a positive finite number",
    );
    expect(() => rankSearchHitsWithBm25(hits, "auth", { b: 2 })).toThrow(
      "b must be a finite number between 0 and 1",
    );
    expect(() => rankSearchHitsWithBm25(hits, "auth", { limit: 0 })).toThrow(
      "bm25 limit must be a positive integer when provided",
    );
  });
});
