import { describe, expect, it, vi } from "vitest";

import { createCliProgram } from "../../src/cli.js";
import {
  ServiceContainer,
  TOKENS,
  type Token,
} from "../../src/core/container.js";
import { getDefaultHookAuditSink } from "../../src/hooks/index.js";
import type {
  ProgressReportPipeline,
  SkillEffectivenessStore,
} from "../../src/evals/index.js";
import type {
  CostTrackingMiddleware,
  SessionMetricsTracker,
} from "../../src/telemetry/index.js";
import type {
  ExpertOrchestrator,
  ScoutSubagent,
} from "../../src/agents/index.js";
import type { MemoryManager } from "../../src/memory/index.js";

describe("CLI debug observability", () => {
  it("records agent_run telemetry for agents:scout boundary", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createScoutHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "scout",
        sessionId: "session-telemetry-boundary",
        handoffId: "h-scout-boundary",
        attempt: 1,
        query: "trace",
        filePaths: ["src/cli.ts"],
        domains: ["backend"],
        metadata: {
          reason: "context_discovery",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const scout = {
      analyze: vi.fn().mockResolvedValue({
        summary: "ok",
        relevantFiles: ["src/cli.ts"],
        rankedFiles: [],
        domains: ["backend"],
        notes: [],
        risks: [],
      }),
    };
    const tracker = { recordAgentRun: vi.fn() };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () => scout as unknown as ScoutSubagent,
    );
    container.registerSingleton(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
      () => tracker as unknown as SessionMetricsTracker,
    );

    const program = createCliProgram({
      container,
      stdout: { write: (chunk: string) => (writes.push(chunk), true) },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:scout",
      "trace",
      "--session",
      "session-telemetry-boundary",
      "--files",
      "src/cli.ts",
      "--domains",
      "backend",
    ]);

    expect(tracker.recordAgentRun).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writes.join("")).analysis.summary).toBe("ok");
  });

  it("prints deterministic debug commands output", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const tracker = {
      listSessionEvents: vi.fn().mockReturnValue([
        {
          kind: "agent_run",
          sessionId: "session-debug-1",
          timestamp: 1,
          agentId: "scout",
          success: true,
          durationMs: 10,
          tokensIn: 100,
          tokensOut: 50,
          retries: 0,
          costUsd: 0.00045,
        },
        {
          kind: "search_run",
          sessionId: "session-debug-1",
          timestamp: 3,
          query: "trace auth",
          provider: "ripgrep+bm25",
          durationMs: 12,
          resultCount: 4,
        },
      ]),
    };
    const progress = {
      latestByAgent: vi.fn().mockReturnValue([
        {
          sessionId: "session-debug-1",
          timestamp: 2,
          agent: "scout",
          status: "completed",
          progress: 100,
          metrics: { tokens: 150, latency_ms: 10, retries: 0 },
        },
      ]),
    };
    const skills = {
      summarizeAllSkills: vi.fn().mockReturnValue([
        {
          skillName: "typescript-best-practices",
          activations: 1,
          successes: 1,
          failures: 0,
          successRate: 1,
          avgLatencyMs: 10,
          avgTokens: 100,
        },
      ]),
    };
    const cost = {
      summarizeSession: vi
        .fn()
        .mockReturnValue({ sessionId: "session-debug-1", events: 0 }),
    };
    const memory = {
      listAll: vi.fn().mockReturnValue([
        {
          id: "1",
          scope: "session",
          scopeId: "session-debug-1",
          key: "k",
          value: "v",
          temperature: "hot",
          createdAt: 0,
          updatedAt: 0,
          lastAccessedAt: 0,
          accessCount: 1,
        },
      ]),
    };

    container.registerSingleton(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
      () => tracker as unknown as SessionMetricsTracker,
    );
    container.registerSingleton(
      TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
      () => progress as unknown as ProgressReportPipeline,
    );
    container.registerSingleton(
      TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
      () => skills as unknown as SkillEffectivenessStore,
    );
    container.registerSingleton(
      TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
      () => cost as unknown as CostTrackingMiddleware,
    );
    container.registerSingleton(
      TOKENS.MemoryManager as Token<MemoryManager>,
      () => memory as unknown as MemoryManager,
    );

    const program = createCliProgram({
      container,
      stdout: { write: (chunk: string) => (writes.push(chunk), true) },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "agents",
      "--session",
      "session-debug-1",
    ]);
    await program.parseAsync(["node", "agent-p", "debug", "skills"]);
    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "tokens",
      "--session",
      "session-debug-1",
    ]);
    await program.parseAsync(["node", "agent-p", "debug", "memory"]);
    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "search",
      "--session",
      "session-debug-1",
    ]);

    expect(writes).toHaveLength(5);
    expect(JSON.parse(writes[0] ?? "{}").agents[0].agentId).toBe("scout");
    expect(JSON.parse(writes[1] ?? "{}").skills[0].skillName).toBe(
      "typescript-best-practices",
    );
    expect(JSON.parse(writes[2] ?? "{}").sessionId).toBe("session-debug-1");
    expect(JSON.parse(writes[3] ?? "{}").byScope.session).toBe(1);
    expect(JSON.parse(writes[4] ?? "{}").searchRuns.total).toBe(1);
  });

  it("prints debug hooks audit events", async () => {
    const sink = getDefaultHookAuditSink();
    sink.clear();
    sink.write({
      hook: "pre_tool_use",
      sessionId: "session-hook-debug",
      platform: "neutral",
      status: "executed",
      timestamp: 1,
      latencyMs: 2,
      decision: "allow",
      payloadPreview: "{}",
      contextPreview: "{}",
    });

    const writes: string[] = [];
    const program = createCliProgram({
      container: new ServiceContainer(),
      stdout: { write: (chunk: string) => (writes.push(chunk), true) },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "hooks",
      "--limit",
      "1",
    ]);

    const payload = JSON.parse(writes.join("")) as Array<{ hook: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.hook).toBe("pre_tool_use");
    sink.clear();
  });

  it("orders debug search error samples deterministically", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const tracker = {
      listSessionEvents: vi.fn().mockReturnValue([
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 50,
          query: "q5",
          provider: "ripgrep+bm25",
          durationMs: 5,
          resultCount: 1,
          error: "error-5",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 10,
          query: "q1",
          provider: "ripgrep+bm25",
          durationMs: 1,
          resultCount: 0,
          error: "error-1",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 40,
          query: "q4",
          provider: "ripgrep+bm25",
          durationMs: 4,
          resultCount: 1,
          error: "error-4",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 20,
          query: "q2",
          provider: "ripgrep+bm25",
          durationMs: 2,
          resultCount: 0,
          error: "error-2",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 30,
          query: "q3",
          provider: "ripgrep+bm25",
          durationMs: 3,
          resultCount: 0,
          error: "error-3",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 60,
          query: "q6",
          provider: "ripgrep+bm25",
          durationMs: 6,
          resultCount: 1,
          error: "error-6",
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 25,
          query: "q-success",
          provider: "ripgrep+bm25",
          durationMs: 2,
          resultCount: 3,
        },
        {
          kind: "search_run",
          sessionId: "session-search-order",
          timestamp: 70,
          query: "q7",
          provider: "ripgrep+bm25",
          durationMs: 7,
          resultCount: 2,
          error: "error-7",
        },
      ]),
    };

    container.registerSingleton(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
      () => tracker as unknown as SessionMetricsTracker,
    );

    const program = createCliProgram({
      container,
      stdout: { write: (chunk: string) => (writes.push(chunk), true) },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "search",
      "--session",
      "session-search-order",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      recentErrors: Array<{ timestamp: number; query: string }>;
    };

    expect(payload.recentErrors.map((event) => event.timestamp)).toEqual([
      30, 40, 50, 60, 70,
    ]);
    expect(payload.recentErrors.map((event) => event.query)).toEqual([
      "q3",
      "q4",
      "q5",
      "q6",
      "q7",
    ]);
  });

  it("runs debug prune with configurable retention", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const cost = {
      prune: vi.fn().mockReturnValue({ recordsDeleted: 2 }),
    };
    const progress = {
      prune: vi.fn().mockReturnValue({ recordsDeleted: 1 }),
    };
    const skills = {
      prune: vi.fn().mockReturnValue({ recordsDeleted: 3 }),
    };

    container.registerSingleton(
      TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
      () => cost as unknown as CostTrackingMiddleware,
    );
    container.registerSingleton(
      TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
      () => progress as unknown as ProgressReportPipeline,
    );
    container.registerSingleton(
      TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
      () => skills as unknown as SkillEffectivenessStore,
    );

    const program = createCliProgram({
      container,
      stdout: { write: (chunk: string) => (writes.push(chunk), true) },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "debug",
      "prune",
      "--tokens-max-age-days",
      "10",
      "--progress-max-age-days",
      "20",
      "--skills-max-age-days",
      "30",
    ]);

    expect(cost.prune).toHaveBeenCalledWith({ maxAgeDays: 10 });
    expect(progress.prune).toHaveBeenCalledWith({ maxAgeDays: 20 });
    expect(skills.prune).toHaveBeenCalledWith({ maxAgeDays: 30 });
    expect(JSON.parse(writes.join("")).streams.tokens.recordsDeleted).toBe(2);
  });
});
