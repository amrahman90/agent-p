import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveSearchRoot,
  sanitizeSearchLimit,
  sanitizeSearchQuery,
  sanitizeSearchRequest,
} from "../../src/search/sanitize.js";

describe("search sanitization", () => {
  it("sanitizes query and limit defaults", () => {
    expect(sanitizeSearchQuery("  auth token  ")).toBe("auth token");
    expect(sanitizeSearchLimit(undefined)).toBe(50);
  });

  it("rejects empty and oversized query input", () => {
    expect(() => sanitizeSearchQuery("   ")).toThrow(
      "search query must be a non-empty string",
    );

    const oversized = "a".repeat(257);
    expect(() => sanitizeSearchQuery(oversized)).toThrow(
      "search query exceeds max length of 256",
    );
  });

  it("resolves a relative root under workspace and blocks traversal", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-"));
    const srcDir = join(workspaceRoot, "src");
    mkdirSync(srcDir, { recursive: true });

    expect(resolveSearchRoot(workspaceRoot, "src")).toBe(realpathSync(srcDir));
    expect(() => resolveSearchRoot(workspaceRoot, "../")).toThrow(
      "search root must stay within workspace root",
    );
  });

  it("rejects unsafe regex flags and conflicting case sensitivity", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-search-"));

    expect(() =>
      sanitizeSearchRequest(
        {
          query: "foo",
          mode: "literal",
          regexFlags: "i",
        },
        workspaceRoot,
      ),
    ).toThrow("regex flags are only allowed when mode is 'regex'");

    expect(() =>
      sanitizeSearchRequest(
        {
          query: "foo",
          mode: "regex",
          regexFlags: "z",
        },
        workspaceRoot,
      ),
    ).toThrow("unsupported regex flag: z");

    expect(() =>
      sanitizeSearchRequest(
        {
          query: "foo",
          mode: "regex",
          regexFlags: "i",
          caseSensitive: true,
        },
        workspaceRoot,
      ),
    ).toThrow("caseSensitive=true cannot be combined with regex flag 'i'");
  });
});
