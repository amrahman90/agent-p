import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  D3WorkflowEngine,
  FileD3WorkflowCheckpointStore,
  type D3WorkflowCheckpoint,
  type D3WorkflowPlan,
} from "../../src/workflow/index.js";

const createCheckpoint = (
  plan: D3WorkflowPlan,
  updatedAt: number,
): D3WorkflowCheckpoint => ({
  sessionId: plan.sessionId,
  plan,
  continueOnFailure: false,
  nextPhaseOrder: 1,
  phases: [],
  failures: [],
  context: {
    filePaths: [],
    domains: [],
  },
  runtime: {
    cache: {
      enabled: true,
      hits: 0,
      misses: 0,
    },
    reindex: {
      requested: false,
      applied: false,
    },
  },
  status: "completed",
  updatedAt,
});

describe("FileD3WorkflowCheckpointStore", () => {
  it("cleans stale planning index entries while loading reusable checkpoints", () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), "agent-p-workflow-store-"));
    try {
      const store = new FileD3WorkflowCheckpointStore({ workflowRoot });
      const engine = new D3WorkflowEngine();
      const plan = engine.plan({
        sessionId: "session-index-valid",
        query: "index cleanup",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });

      store.save(createCheckpoint(plan, 100));

      const indexPath = join(workflowRoot, "planning-artifacts", "index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
        entries: Array<{
          cacheKey: string;
          sessionId: string;
          updatedAt: number;
        }>;
      };
      const cacheKey = index.entries[0]?.cacheKey;
      if (cacheKey === undefined) {
        throw new Error("missing cache key in planning index");
      }

      writeFileSync(
        indexPath,
        `${JSON.stringify(
          {
            version: 1,
            entries: [
              { cacheKey, sessionId: "missing-session", updatedAt: 101 },
              ...index.entries,
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const reusable = store.loadReusable(plan);
      expect(reusable?.sessionId).toBe("session-index-valid");

      const cleanedIndex = JSON.parse(readFileSync(indexPath, "utf8")) as {
        entries: Array<{
          cacheKey: string;
          sessionId: string;
          updatedAt: number;
        }>;
      };
      expect(
        cleanedIndex.entries.some(
          (entry) => entry.sessionId === "missing-session",
        ),
      ).toBe(false);
    } finally {
      rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  it("enforces planning artifact retention limit", () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), "agent-p-workflow-store-"));
    try {
      const store = new FileD3WorkflowCheckpointStore({
        workflowRoot,
        planningArtifactRetentionLimit: 2,
      });
      const engine = new D3WorkflowEngine();

      const planA = engine.plan({
        sessionId: "session-retain-a",
        query: "retain A",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });
      const planB = engine.plan({
        sessionId: "session-retain-b",
        query: "retain B",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });
      const planC = engine.plan({
        sessionId: "session-retain-c",
        query: "retain C",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });

      store.save(createCheckpoint(planA, 100));
      store.save(createCheckpoint(planB, 200));
      store.save(createCheckpoint(planC, 300));

      const indexPath = join(workflowRoot, "planning-artifacts", "index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
        entries: Array<{
          cacheKey: string;
          sessionId: string;
          updatedAt: number;
        }>;
      };
      expect(index.entries).toHaveLength(2);
      expect(index.entries.map((entry) => entry.sessionId)).toEqual([
        "session-retain-c",
        "session-retain-b",
      ]);
    } finally {
      rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  it("handles corrupted planning index and recovers on next save", () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), "agent-p-workflow-store-"));
    try {
      const store = new FileD3WorkflowCheckpointStore({ workflowRoot });
      const engine = new D3WorkflowEngine();
      const plan = engine.plan({
        sessionId: "session-corrupt-index",
        query: "corrupt index",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });

      const indexDir = join(workflowRoot, "planning-artifacts");
      const indexPath = join(indexDir, "index.json");
      mkdirSync(indexDir, { recursive: true });
      writeFileSync(indexPath, "{corrupted-json", "utf8");

      expect(store.loadReusable(plan)).toBeUndefined();

      store.save(createCheckpoint(plan, 100));
      const recovered = JSON.parse(readFileSync(indexPath, "utf8")) as {
        version: number;
        entries: Array<{
          cacheKey: string;
          sessionId: string;
          updatedAt: number;
        }>;
      };
      expect(recovered.version).toBe(1);
      expect(recovered.entries).toHaveLength(1);
      expect(recovered.entries[0]?.sessionId).toBe("session-corrupt-index");
    } finally {
      rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  it("rejects checkpoint files with malformed runtime context analysis", () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), "agent-p-workflow-store-"));
    try {
      const store = new FileD3WorkflowCheckpointStore({ workflowRoot });
      const engine = new D3WorkflowEngine();
      const plan = engine.plan({
        sessionId: "session-invalid-analysis",
        query: "invalid analysis",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });

      const checkpoint = createCheckpoint(plan, 100);
      const checkpointPath = join(
        workflowRoot,
        "checkpoints",
        "session-invalid-analysis.json",
      );
      mkdirSync(join(workflowRoot, "checkpoints"), { recursive: true });
      writeFileSync(
        checkpointPath,
        `${JSON.stringify({
          ...checkpoint,
          context: {
            ...checkpoint.context,
            analysis: {
              summary: "bad",
              relevantFiles: [123],
              rankedFiles: [],
              domains: ["backend"],
              notes: [],
              risks: [],
            },
          },
        })}\n`,
        "utf8",
      );

      expect(store.load("session-invalid-analysis")).toBeUndefined();
    } finally {
      rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  it("rejects checkpoint files with phase/artifact mismatches", () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), "agent-p-workflow-store-"));
    try {
      const store = new FileD3WorkflowCheckpointStore({ workflowRoot });
      const engine = new D3WorkflowEngine();
      const plan = engine.plan({
        sessionId: "session-invalid-artifact",
        query: "invalid artifact",
        workflowMode: "quick",
        complexity: { fileCount: 1, patternCount: 1 },
      });

      const checkpoint = createCheckpoint(plan, 100);
      const checkpointPath = join(
        workflowRoot,
        "checkpoints",
        "session-invalid-artifact.json",
      );
      mkdirSync(join(workflowRoot, "checkpoints"), { recursive: true });
      writeFileSync(
        checkpointPath,
        `${JSON.stringify({
          ...checkpoint,
          phases: [
            {
              order: 1,
              stage: "design",
              phase: "understand",
              agent: "scout",
              status: "completed",
              startedAt: 10,
              endedAt: 11,
              handoffId: "handoff-invalid-artifact",
              cacheHit: false,
              source: "runtime",
              artifact: {
                summary: "wrong artifact",
                commands: ["pnpm test"],
                expectedChecks: ["tests pass"],
                failureHandling: ["none"],
              },
            },
          ],
        })}\n`,
        "utf8",
      );

      expect(store.load("session-invalid-artifact")).toBeUndefined();
    } finally {
      rmSync(workflowRoot, { recursive: true, force: true });
    }
  });
});
