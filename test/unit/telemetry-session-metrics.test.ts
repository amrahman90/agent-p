import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { SessionMetricsTracker } from "../../src/telemetry/index.js";

describe("SessionMetricsTracker", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("records post-tool-use events and summarizes a session", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-telemetry-"));
    cleanupPaths.push(root);

    const tracker = new SessionMetricsTracker({ telemetryRoot: root });

    tracker.recordPostToolUse({
      payload: {
        sessionId: "session-telemetry-1",
        toolName: "bash",
        toolInput: { command: "pnpm test" },
      },
      result: {
        hook: "post_tool_use",
        status: "executed",
        sessionId: "session-telemetry-1",
        timestamp: 100,
        toolName: "bash",
        decision: "allow",
      },
      latencyMs: 12,
      platform: "neutral",
    });

    tracker.recordAgentRun({
      sessionId: "session-telemetry-1",
      agentId: "reviewer",
      success: true,
      durationMs: 250,
      tokensIn: 1000,
      tokensOut: 500,
      retries: 1,
    });

    tracker.recordSearchRun({
      sessionId: "session-telemetry-1",
      query: "trace auth",
      provider: "ripgrep+bm25",
      durationMs: 30,
      resultCount: 3,
      timestamp: 120,
    });

    const summary = tracker.summarizeSession("session-telemetry-1");
    const events = tracker.listSessionEvents("session-telemetry-1");

    expect(summary.totalEvents).toBe(3);
    expect(summary.postToolUse.total).toBe(1);
    expect(summary.postToolUse.allowed).toBe(1);
    expect(summary.postToolUse.averageLatencyMs).toBe(12);
    expect(summary.agents.totalRuns).toBe(1);
    expect(summary.agents.successRuns).toBe(1);
    expect(summary.agents.totalTokensIn).toBe(1000);
    expect(summary.agents.totalTokensOut).toBe(500);
    expect(summary.agents.totalCostUsd).toBeCloseTo(0.0045, 10);
    expect(events.find((event) => event.kind === "search_run")).toMatchObject({
      kind: "search_run",
      query: "trace auth",
      resultCount: 3,
    });
  });

  it("rejects path traversal-like session identifiers", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-telemetry-"));
    cleanupPaths.push(root);

    const tracker = new SessionMetricsTracker({ telemetryRoot: root });

    expect(() =>
      tracker.recordSearchRun({
        sessionId: "../escape",
        query: "trace auth",
        provider: "ripgrep+bm25",
        durationMs: 10,
        resultCount: 0,
      }),
    ).toThrow("session id may only contain");
  });
});
