import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProgressReportPipeline } from "../../src/evals/index.js";

describe("ProgressReportPipeline", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("records reports and returns latest by agent", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-progress-"));
    cleanupPaths.push(root);

    const pipeline = new ProgressReportPipeline({ telemetryRoot: root });
    pipeline.record({
      sessionId: "session-progress-1",
      agent: "scout",
      status: "running",
      progress: 10,
      tokens: 50,
      latencyMs: 5,
      retries: 0,
      timestamp: 1,
    });
    pipeline.record({
      sessionId: "session-progress-1",
      agent: "scout",
      status: "completed",
      progress: 100,
      tokens: 120,
      latencyMs: 15,
      retries: 0,
      timestamp: 2,
    });

    const latest = pipeline.latestByAgent("session-progress-1");
    expect(latest).toHaveLength(1);
    expect(latest[0]?.status).toBe("completed");
    expect(latest[0]?.metrics.tokens).toBe(120);
  });

  it("prunes old progress records by max age", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-progress-prune-"));
    cleanupPaths.push(root);

    const now = 100 * 86_400_000;
    const pipeline = new ProgressReportPipeline({
      telemetryRoot: root,
      now: () => now,
    });

    pipeline.record({
      sessionId: "session-progress-prune",
      agent: "scout",
      status: "completed",
      progress: 100,
      tokens: 10,
      latencyMs: 1,
      retries: 0,
      timestamp: now - 40 * 86_400_000,
    });
    pipeline.record({
      sessionId: "session-progress-prune",
      agent: "scout",
      status: "completed",
      progress: 100,
      tokens: 20,
      latencyMs: 1,
      retries: 0,
      timestamp: now - 1 * 86_400_000,
    });

    const prune = pipeline.prune({ maxAgeDays: 30 });
    const reports = pipeline.listSessionReports("session-progress-prune");

    expect(prune.recordsDeleted).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.metrics.tokens).toBe(20);
  });
});
