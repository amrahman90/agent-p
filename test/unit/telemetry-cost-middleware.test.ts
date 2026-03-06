import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CostTrackingMiddleware } from "../../src/telemetry/index.js";

describe("CostTrackingMiddleware", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("records and summarizes session token/cost events", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-cost-"));
    cleanupPaths.push(root);

    const cost = new CostTrackingMiddleware({
      telemetryRoot: root,
      now: () => 123,
    });
    cost.recordAgentRunCost({
      sessionId: "session-cost-1",
      agentId: "scout",
      tokensIn: 500,
      tokensOut: 250,
      durationMs: 10,
    });
    cost.recordAgentRunCost({
      sessionId: "session-cost-1",
      agentId: "reviewer",
      tokensIn: 100,
      tokensOut: 100,
      durationMs: 20,
      retries: 1,
    });

    const summary = cost.summarizeSession("session-cost-1");
    expect(summary.events).toBe(2);
    expect(summary.totalTokens).toBe(950);
    expect(summary.totalCostUsd).toBeCloseTo(0.00285, 8);
    expect(summary.byAgent.map((entry) => entry.agentId)).toEqual([
      "reviewer",
      "scout",
    ]);
  });

  it("prunes token streams by max age", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-cost-prune-"));
    cleanupPaths.push(root);

    const now = 200 * 86_400_000;
    const cost = new CostTrackingMiddleware({
      telemetryRoot: root,
      now: () => now,
    });

    cost.recordAgentRunCost({
      sessionId: "session-cost-prune",
      agentId: "scout",
      tokensIn: 10,
      tokensOut: 10,
      durationMs: 1,
      timestamp: now - 40 * 86_400_000,
    });
    cost.recordAgentRunCost({
      sessionId: "session-cost-prune",
      agentId: "scout",
      tokensIn: 20,
      tokensOut: 20,
      durationMs: 1,
      timestamp: now - 2 * 86_400_000,
    });

    const prune = cost.prune({ maxAgeDays: 30 });
    const summary = cost.summarizeSession("session-cost-prune");

    expect(prune.recordsDeleted).toBe(2);
    expect(summary.events).toBe(1);
    expect(summary.totalTokens).toBe(40);
  });
});
