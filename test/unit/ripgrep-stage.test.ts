import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  buildRipgrepArgs,
  parseRipgrepJsonLine,
  parseRipgrepJsonOutput,
  RipgrepSearchStage,
} from "../../src/search/ripgrep.js";
import { sanitizeSearchRequest } from "../../src/search/sanitize.js";

describe("RipgrepSearchStage", () => {
  it("builds ripgrep arguments with fixed-string search", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const request = sanitizeSearchRequest(
      { query: "AuthToken" },
      workspaceRoot,
    );

    const args = buildRipgrepArgs(request);
    expect(args).toContain("--fixed-strings");
    expect(args).toContain("-i");
    expect(args).toContain("-e");
    expect(args.at(-2)).toBe("AuthToken");
    expect(args.at(-1)).toBe(".");
  });

  it("builds ripgrep arguments for regex, flags, and hidden files", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const request = sanitizeSearchRequest(
      {
        query: "error.*token",
        mode: "regex",
        regexFlags: "ms",
        caseSensitive: true,
        includeHidden: true,
        limit: 3,
      },
      workspaceRoot,
    );

    const args = buildRipgrepArgs(request);
    expect(args).not.toContain("--fixed-strings");
    expect(args).not.toContain("-i");
    expect(args).toContain("--multiline");
    expect(args).toContain("--multiline-dotall");
    expect(args).toContain("--hidden");
  });

  it("returns undefined for non-match ripgrep events", () => {
    expect(
      parseRipgrepJsonLine(
        JSON.stringify({ type: "summary", data: { elapsed_total: 1 } }),
      ),
    ).toBeUndefined();
  });

  it("normalizes missing line and column fields to one", () => {
    const parsed = parseRipgrepJsonLine(
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "src/sample.ts" },
          lines: { text: "value\n" },
        },
      }),
    );

    expect(parsed).toEqual({
      filePath: "src/sample.ts",
      line: 1,
      column: 1,
      preview: "value",
      score: 0,
    });
  });

  it("returns undefined when match event has no path", () => {
    expect(
      parseRipgrepJsonLine(
        JSON.stringify({
          type: "match",
          data: { line_number: 3, lines: { text: "hello" } },
        }),
      ),
    ).toBeUndefined();
  });

  it("parses ripgrep JSON output into normalized hits", () => {
    const output = [
      JSON.stringify({
        type: "begin",
        data: { path: { text: "src/sample.ts" } },
      }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "src/sample.ts" },
          lines: { text: "const token = loadToken();\n" },
          line_number: 14,
          submatches: [{ start: 6, end: 11 }],
        },
      }),
      JSON.stringify({
        type: "summary",
        data: { elapsed_total: { human: "0.005s" } },
      }),
    ].join("\n");

    const parsed = parseRipgrepJsonOutput(output);
    expect(parsed).toEqual([
      {
        filePath: "src/sample.ts",
        line: 14,
        column: 7,
        preview: "const token = loadToken();",
        score: 0,
      },
    ]);
  });

  it("executes ripgrep with argument arrays and returns parsed hits", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });

    const spawnProcess = vi.fn((command: string, args: readonly string[]) => {
      const processHandle = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };

      processHandle.stdout = new PassThrough();
      processHandle.stderr = new PassThrough();

      queueMicrotask(() => {
        processHandle.stdout.write(
          `${JSON.stringify({
            type: "match",
            data: {
              path: { text: "src/search.ts" },
              lines: { text: "export const search = true;\n" },
              line_number: 3,
              submatches: [{ start: 13, end: 19 }],
            },
          })}\n`,
        );
        processHandle.stdout.end();
        processHandle.emit("close", 0);
      });

      expect(command).toBe("rg");
      expect(args).toContain("--json");
      expect(args).toContain("needle");

      return processHandle as never;
    });

    const stage = new RipgrepSearchStage({ workspaceRoot, spawnProcess });
    const hits = await stage.search({
      query: "needle",
      root: "src",
      limit: 5,
    });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([
      {
        filePath: "src/search.ts",
        line: 3,
        column: 14,
        preview: "export const search = true;",
        score: 0,
      },
    ]);
  });

  it("rejects when ripgrep process emits an error", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const spawnProcess = vi.fn(() => {
      const processHandle = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };

      processHandle.stdout = new PassThrough();
      processHandle.stderr = new PassThrough();

      queueMicrotask(() => {
        processHandle.emit("error", new Error("spawn failed"));
      });

      return processHandle as never;
    });

    const stage = new RipgrepSearchStage({ workspaceRoot, spawnProcess });

    await expect(stage.search({ query: "needle" })).rejects.toThrow(
      "failed to execute ripgrep: spawn failed",
    );
  });

  it("rejects when ripgrep exits with a non-search failure code", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const spawnProcess = vi.fn(() => {
      const processHandle = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };

      processHandle.stdout = new PassThrough();
      processHandle.stderr = new PassThrough();

      queueMicrotask(() => {
        processHandle.stderr.write("permission denied");
        processHandle.stderr.end();
        processHandle.emit("close", 2);
      });

      return processHandle as never;
    });

    const stage = new RipgrepSearchStage({ workspaceRoot, spawnProcess });

    await expect(stage.search({ query: "needle" })).rejects.toThrow(
      "ripgrep exited with code 2: permission denied",
    );
  });

  it("returns no hits when ripgrep exits with code 1", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const spawnProcess = vi.fn(() => {
      const processHandle = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };

      processHandle.stdout = new PassThrough();
      processHandle.stderr = new PassThrough();

      queueMicrotask(() => {
        processHandle.stdout.end();
        processHandle.emit("close", 1);
      });

      return processHandle as never;
    });

    const stage = new RipgrepSearchStage({ workspaceRoot, spawnProcess });
    await expect(stage.search({ query: "needle" })).resolves.toEqual([]);
  });

  it("rejects when ripgrep JSON output is invalid", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-p-rg-"));
    const spawnProcess = vi.fn(() => {
      const processHandle = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };

      processHandle.stdout = new PassThrough();
      processHandle.stderr = new PassThrough();

      queueMicrotask(() => {
        processHandle.stdout.write("{not-valid-json}\n");
        processHandle.stdout.end();
        processHandle.emit("close", 0);
      });

      return processHandle as never;
    });

    const stage = new RipgrepSearchStage({ workspaceRoot, spawnProcess });

    await expect(stage.search({ query: "needle" })).rejects.toThrow(
      "failed to parse ripgrep output",
    );
  });
});
