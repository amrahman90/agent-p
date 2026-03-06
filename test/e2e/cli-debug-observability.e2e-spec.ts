import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProgressReportPipeline,
  SkillEffectivenessStore,
} from "../../src/evals/index.js";
import { SessionMetricsTracker } from "../../src/telemetry/index.js";

const SESSION_ID = "session-debug-e2e";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../..");
const tsxLoaderUrl = pathToFileURL(
  resolve(workspaceRoot, "node_modules", "tsx", "dist", "loader.mjs"),
).href;
const cliModuleUrl = pathToFileURL(
  resolve(workspaceRoot, "src", "cli.ts"),
).href;

const runCliInTempWorkspace = (
  args: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsxLoaderUrl,
        "--eval",
        `import(${JSON.stringify(cliModuleUrl)}).then((m) => m.runCli(process.argv)).catch((error) => { process.stderr.write(String(error) + "\\n"); process.exitCode = 1; });`,
        "agent-p",
        ...args,
      ],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => rejectRun(error));
    child.on("close", (code) => {
      resolveRun({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};

describe("CLI debug observability snapshots", () => {
  let rootDir = "";

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "agent-p-debug-e2e-"));
    mkdirSync(join(rootDir, "src", "skills"), { recursive: true });

    writeFileSync(
      join(rootDir, "src", "skills", "skills.json"),
      JSON.stringify(
        {
          version: "0.0.1",
          skills: [
            {
              id: "typescript-best-practices",
              name: "TypeScript Best Practices",
              description: "Type-focused coding conventions",
              domains: ["typescript"],
              triggers: ["typescript"],
              activation: "auto",
              priority: "high",
              contextLoad: "minimal",
              permissions: { allowedAgents: ["scout", "builder"] },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const telemetryRoot = join(rootDir, ".agent-p", "telemetry");
    const evalsRoot = join(rootDir, ".agent-p", "evals");
    const now = 1_700_000_000_000;

    const metrics = new SessionMetricsTracker({
      telemetryRoot,
      now: () => now,
    });
    metrics.recordAgentRun({
      sessionId: SESSION_ID,
      agentId: "scout",
      success: true,
      durationMs: 42,
      tokensIn: 120,
      tokensOut: 80,
      retries: 0,
    });
    metrics.recordSearchRun({
      sessionId: SESSION_ID,
      query: "trace auth",
      provider: "ripgrep+bm25",
      durationMs: 15,
      resultCount: 3,
      timestamp: now,
    });

    const progress = new ProgressReportPipeline({
      telemetryRoot,
      now: () => now,
    });
    progress.record({
      sessionId: SESSION_ID,
      agent: "scout",
      status: "completed",
      progress: 100,
      tokens: 200,
      latencyMs: 42,
      retries: 0,
      timestamp: now,
    });

    const skills = new SkillEffectivenessStore({
      evalsRoot,
      now: () => now,
    });
    skills.recordActivation({
      sessionId: SESSION_ID,
      skillName: "typescript-best-practices",
      success: true,
      latencyMs: 9,
      tokens: 77,
      timestamp: now,
    });
  });

  afterEach(() => {
    if (rootDir.length > 0) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("locks JSON shape for all debug commands", async () => {
    const commands: Array<readonly string[]> = [
      ["debug", "agents", "--session", SESSION_ID],
      ["debug", "skills"],
      ["debug", "memory"],
      ["debug", "search", "--session", SESSION_ID],
      ["debug", "tokens", "--session", SESSION_ID],
      ["debug", "hooks"],
    ];

    const payloads: unknown[] = [];
    for (const args of commands) {
      const result = await runCliInTempWorkspace(args, rootDir);
      expect(result.exitCode, `${args.join(" ")} -> ${result.stderr}`).toBe(0);
      expect(result.stderr).toBe("");
      payloads.push(JSON.parse(result.stdout) as unknown);
    }

    const [agents, skills, memory, search, tokens, hooks] = payloads;

    expect(agents).toMatchInlineSnapshot(`
      {
        "agents": [
          {
            "agentId": "scout",
            "averageDurationMs": 42,
            "costUsd": 0.0006000000000000001,
            "failures": 0,
            "retries": 0,
            "runs": 1,
            "successRate": 1,
            "tokensIn": 120,
            "tokensOut": 80,
          },
        ],
        "latestProgressReports": [
          {
            "agent": "scout",
            "metrics": {
              "latency_ms": 42,
              "retries": 0,
              "tokens": 200,
            },
            "progress": 100,
            "sessionId": "session-debug-e2e",
            "status": "completed",
            "timestamp": 1700000000000,
          },
        ],
        "sessionId": "session-debug-e2e",
      }
    `);
    expect(skills).toMatchInlineSnapshot(`
      {
        "skills": [
          {
            "activations": 1,
            "avgLatencyMs": 9,
            "avgTokens": 77,
            "failures": 0,
            "skillName": "typescript-best-practices",
            "successRate": 1,
            "successes": 1,
          },
        ],
        "totals": {
          "activations": 1,
          "failures": 0,
          "successes": 1,
        },
      }
    `);
    expect(memory).toMatchInlineSnapshot(`
      {
        "byScope": {
          "private": 0,
          "session": 0,
          "shared": 0,
          "user": 0,
        },
        "entries": 0,
      }
    `);
    expect(search).toMatchInlineSnapshot(`
      {
        "events": [
          {
            "durationMs": 15,
            "provider": "ripgrep+bm25",
            "query": "trace auth",
            "result_count": 3,
            "timestamp": 1700000000000,
          },
        ],
        "pipeline": {
          "available": true,
          "stages": [
            "sanitize",
            "ripgrep",
            "bm25",
          ],
        },
        "providers": [
          {
            "provider": "ripgrep+bm25",
            "runs": 1,
          },
        ],
        "recentErrors": [],
        "searchRuns": {
          "averageDurationMs": 15,
          "averageResultCount": 3,
          "failures": 0,
          "successes": 1,
          "total": 1,
        },
        "sessionId": "session-debug-e2e",
      }
    `);
    expect(tokens).toMatchInlineSnapshot(`
      {
        "byAgent": [
          {
            "agentId": "scout",
            "averageDurationMs": 42,
            "runs": 1,
            "totalCostUsd": 0.0006000000000000001,
            "totalTokens": 200,
          },
        ],
        "events": 1,
        "sessionId": "session-debug-e2e",
        "totalCostUsd": 0.0006000000000000001,
        "totalTokens": 200,
        "totalTokensIn": 120,
        "totalTokensOut": 80,
      }
    `);
    expect(hooks).toMatchInlineSnapshot(`[]`);
  });

  it("locks debug search recentErrors ordering for real CLI execution", async () => {
    const telemetryRoot = join(rootDir, ".agent-p", "telemetry");
    const tracker = new SessionMetricsTracker({ telemetryRoot });

    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q5",
      provider: "ripgrep+bm25",
      durationMs: 5,
      resultCount: 1,
      error: "error-5",
      timestamp: 50,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q1",
      provider: "ripgrep+bm25",
      durationMs: 1,
      resultCount: 0,
      error: "error-1",
      timestamp: 10,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q4",
      provider: "ripgrep+bm25",
      durationMs: 4,
      resultCount: 1,
      error: "error-4",
      timestamp: 40,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q2",
      provider: "ripgrep+bm25",
      durationMs: 2,
      resultCount: 0,
      error: "error-2",
      timestamp: 20,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q3",
      provider: "ripgrep+bm25",
      durationMs: 3,
      resultCount: 0,
      error: "error-3",
      timestamp: 30,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q6",
      provider: "ripgrep+bm25",
      durationMs: 6,
      resultCount: 2,
      error: "error-6",
      timestamp: 60,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q-success",
      provider: "ripgrep+bm25",
      durationMs: 2,
      resultCount: 3,
      timestamp: 25,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "q7",
      provider: "ripgrep+bm25",
      durationMs: 7,
      resultCount: 2,
      error: "error-7",
      timestamp: 70,
    });

    const result = await runCliInTempWorkspace(
      ["debug", "search", "--session", SESSION_ID],
      rootDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout) as {
      recentErrors: Array<{
        timestamp: number;
        query: string;
        provider: string;
        error: string;
      }>;
      events: Array<{
        timestamp: number;
        query: string;
      }>;
    };

    expect(payload.recentErrors).toMatchInlineSnapshot(`
      [
        {
          "error": "error-3",
          "provider": "ripgrep+bm25",
          "query": "q3",
          "timestamp": 30,
        },
        {
          "error": "error-4",
          "provider": "ripgrep+bm25",
          "query": "q4",
          "timestamp": 40,
        },
        {
          "error": "error-5",
          "provider": "ripgrep+bm25",
          "query": "q5",
          "timestamp": 50,
        },
        {
          "error": "error-6",
          "provider": "ripgrep+bm25",
          "query": "q6",
          "timestamp": 60,
        },
        {
          "error": "error-7",
          "provider": "ripgrep+bm25",
          "query": "q7",
          "timestamp": 70,
        },
      ]
    `);
    expect(payload.events.map((event) => event.timestamp)).toEqual([
      10, 20, 25, 30, 40, 50, 60, 70, 1_700_000_000_000,
    ]);
    expect(payload.events.map((event) => event.query)).toEqual([
      "q1",
      "q2",
      "q-success",
      "q3",
      "q4",
      "q5",
      "q6",
      "q7",
      "trace auth",
    ]);
  });

  it("locks debug search tie-break ordering when timestamps are identical", async () => {
    const telemetryRoot = join(rootDir, ".agent-p", "telemetry");
    const tracker = new SessionMetricsTracker({ telemetryRoot });

    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "delta",
      provider: "ripgrep+bm25",
      durationMs: 4,
      resultCount: 0,
      error: "e4",
      timestamp: 100,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "alpha",
      provider: "z-provider",
      durationMs: 2,
      resultCount: 0,
      error: "e2",
      timestamp: 100,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "alpha",
      provider: "ripgrep+bm25",
      durationMs: 1,
      resultCount: 0,
      error: "e1",
      timestamp: 100,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "alpha",
      provider: "ripgrep+bm25",
      durationMs: 1,
      resultCount: 0,
      error: "e0",
      timestamp: 100,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "charlie",
      provider: "ripgrep+bm25",
      durationMs: 3,
      resultCount: 0,
      error: "e3",
      timestamp: 100,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "early",
      provider: "ripgrep+bm25",
      durationMs: 9,
      resultCount: 0,
      error: "e-early",
      timestamp: 90,
    });
    tracker.recordSearchRun({
      sessionId: SESSION_ID,
      query: "bravo",
      provider: "ripgrep+bm25",
      durationMs: 8,
      resultCount: 4,
      timestamp: 100,
    });

    const result = await runCliInTempWorkspace(
      ["debug", "search", "--session", SESSION_ID],
      rootDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout) as {
      recentErrors: Array<{
        timestamp: number;
        query: string;
        provider: string;
        error: string;
      }>;
      events: Array<{
        timestamp: number;
        query: string;
        provider: string;
        errors?: string;
      }>;
    };

    expect(payload.recentErrors).toEqual([
      {
        timestamp: 100,
        query: "alpha",
        provider: "ripgrep+bm25",
        error: "e0",
      },
      {
        timestamp: 100,
        query: "alpha",
        provider: "ripgrep+bm25",
        error: "e1",
      },
      {
        timestamp: 100,
        query: "alpha",
        provider: "z-provider",
        error: "e2",
      },
      {
        timestamp: 100,
        query: "charlie",
        provider: "ripgrep+bm25",
        error: "e3",
      },
      {
        timestamp: 100,
        query: "delta",
        provider: "ripgrep+bm25",
        error: "e4",
      },
    ]);

    expect(
      payload.events.map(
        (event) =>
          `${event.timestamp}|${event.query}|${event.provider}|${event.errors ?? ""}`,
      ),
    ).toEqual([
      "90|early|ripgrep+bm25|e-early",
      "100|alpha|ripgrep+bm25|e0",
      "100|alpha|ripgrep+bm25|e1",
      "100|alpha|z-provider|e2",
      "100|bravo|ripgrep+bm25|",
      "100|charlie|ripgrep+bm25|e3",
      "100|delta|ripgrep+bm25|e4",
      "1700000000000|trace auth|ripgrep+bm25|",
    ]);
  });
});
