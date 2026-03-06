import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { SearchEngine } from "../../src/search/api.js";

const hasRipgrepBinary = (): boolean => {
  const result = spawnSync("rg", ["--version"], {
    stdio: "ignore",
  });

  return result.status === 0;
};

const describeIfRipgrep = hasRipgrepBinary() ? describe : describe.skip;

describeIfRipgrep("SearchEngine integration (real ripgrep)", () => {
  it("runs sanitize -> ripgrep -> bm25 ranking end-to-end", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-int-"));
    const srcRoot = resolve(workspaceRoot, "src");
    mkdirSync(srcRoot, { recursive: true });

    writeFileSync(
      join(srcRoot, "auth-primary.ts"),
      "export const line = 'auth token auth token auth token';\n",
      "utf8",
    );
    writeFileSync(
      join(srcRoot, "auth-secondary.ts"),
      "export const line = 'auth token';\n",
      "utf8",
    );
    writeFileSync(
      join(srcRoot, "noise.ts"),
      "export const line = 'unrelated value';\n",
      "utf8",
    );

    const engine = new SearchEngine({ workspaceRoot });
    const response = await engine.query({
      query: "auth token",
      root: "src",
      limit: 10,
      mode: "literal",
    });

    expect(response.query).toBe("auth token");
    expect(response.root).toBe(srcRoot);
    expect(response.mode).toBe("literal");
    expect(response.limit).toBe(10);
    expect(response.totalCandidates).toBe(2);
    expect(response.hits).toHaveLength(2);
    expect(response.hits[0]?.score).toBeGreaterThan(
      response.hits[1]?.score ?? 0,
    );
    expect(
      response.hits.some((hit) => hit.filePath.endsWith("auth-primary.ts")),
    ).toBe(true);
    expect(
      response.hits.some((hit) => hit.filePath.endsWith("auth-secondary.ts")),
    ).toBe(true);
  });

  it("returns no hits when ripgrep finds no matches", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-int-"));
    const srcRoot = resolve(workspaceRoot, "src");
    mkdirSync(srcRoot, { recursive: true });

    writeFileSync(
      join(srcRoot, "tokens.ts"),
      "export const line = 'just one token';\n",
      "utf8",
    );

    const engine = new SearchEngine({ workspaceRoot });
    const response = await engine.query({
      query: "auth token",
      root: "src",
      limit: 5,
      mode: "literal",
    });

    expect(response.totalCandidates).toBe(0);
    expect(response.hits).toEqual([]);
  });
});
