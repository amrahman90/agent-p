import { describe, expect, it, vi } from "vitest";

import { ExpertOrchestrator } from "../../src/agents/index.js";
import {
  D3WorkflowEngine,
  D3WorkflowExecutor,
  type D3WorkflowCheckpoint,
  type D3WorkflowCheckpointStore,
  type D3WorkflowPhaseExecutionResult,
  type D3WorkflowPlan,
} from "../../src/workflow/index.js";

const createIncrementingClock = (start = 1_700_000_000_000): (() => number) => {
  let current = start;
  return () => {
    const value = current;
    current += 1;
    return value;
  };
};

class InMemoryCheckpointStore implements D3WorkflowCheckpointStore {
  private readonly checkpoints = new Map<string, D3WorkflowCheckpoint>();

  private readonly planKeyToSession = new Map<string, string>();

  private toPlanKey(plan: D3WorkflowPlan): string {
    return JSON.stringify({
      query: plan.query,
      workflowMode: plan.workflowMode,
      effectiveWorkflowMode: plan.effectiveWorkflowMode,
      analysisMode: plan.analysisMode,
      complexity: plan.complexity,
      phaseSignature: plan.phases.map(
        (phasePlan) =>
          `${phasePlan.order}:${phasePlan.phase}:${phasePlan.stage}`,
      ),
      skippedPhases: plan.skippedPhases,
    });
  }

  load(sessionId: string): D3WorkflowCheckpoint | undefined {
    return this.checkpoints.get(sessionId);
  }

  loadReusable(plan: D3WorkflowPlan): D3WorkflowCheckpoint | undefined {
    const sessionId = this.planKeyToSession.get(this.toPlanKey(plan));
    return sessionId ? this.checkpoints.get(sessionId) : undefined;
  }

  save(checkpoint: D3WorkflowCheckpoint): void {
    this.checkpoints.set(checkpoint.sessionId, checkpoint);
    this.planKeyToSession.set(
      this.toPlanKey(checkpoint.plan),
      checkpoint.sessionId,
    );
  }
}

describe("D3WorkflowExecutor", () => {
  it("executes quick workflow phases in deterministic order", async () => {
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-exec-1",
      query: "implement auth flow",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const order: string[] = [];
    const expert = new ExpertOrchestrator(createIncrementingClock());
    const executor = new D3WorkflowExecutor(
      expert,
      {
        scout: {
          analyze: vi.fn(async ({ handoff }) => {
            order.push(`scout:${handoff.attempt}`);
            return {
              summary: "scout analysis",
              relevantFiles: ["src/auth.ts"],
              rankedFiles: [],
              domains: ["backend"],
              notes: [],
              risks: [],
            };
          }),
        },
        builder: {
          plan: vi.fn(async ({ handoff }) => {
            order.push(`builder:${handoff.attempt}`);
            return {
              summary: "builder plan",
              plannedChanges: ["src/auth.ts", "domain:backend"],
              risks: [],
            };
          }),
        },
        tester: {
          plan: vi.fn(async ({ handoff }) => {
            order.push(`tester:${handoff.attempt}`);
            return {
              summary: "tester plan",
              commands: ["pnpm test"],
              expectedChecks: ["tests pass"],
              failureHandling: ["capture logs"],
            };
          }),
        },
        reviewer: {
          assess: vi.fn(async ({ handoff }) => {
            order.push(`reviewer:${handoff.attempt}`);
            return {
              summary: "review",
              findings: [],
            };
          }),
        },
        verifier: {
          assess: vi.fn(async ({ handoff }) => {
            order.push(`verifier:${handoff.attempt}`);
            return {
              summary: "verify",
              trustScore: 1,
              threshold: 0.75,
              gateDecision: "pass" as const,
              checks: [],
              blockers: [],
            };
          }),
        },
      },
      createIncrementingClock(2_000),
    );

    const result = await executor.execute({
      plan,
      filePaths: ["src/auth.ts"],
      domains: ["backend"],
    });

    expect(result.status).toBe("completed");
    expect(order).toEqual([
      "scout:1",
      "scout:2",
      "tester:3",
      "builder:4",
      "verifier:5",
      "verifier:6",
    ]);
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      "understand",
      "plan",
      "implement-red",
      "build-green",
      "verify",
      "deliver",
    ]);
    expect(
      result.phases.every((phase) => phase.startedAt <= phase.endedAt),
    ).toBe(true);

    const phaseList = result.phases as D3WorkflowPhaseExecutionResult[];
    for (let index = 1; index < phaseList.length; index += 1) {
      expect(phaseList[index]?.parentHandoffId).toBe(
        phaseList[index - 1]?.handoffId,
      );
    }
  });

  it("fails fast when a phase throws and continueOnFailure is false", async () => {
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-exec-2",
      query: "auth hardening",
      workflowMode: "static",
      complexity: { fileCount: 10, patternCount: 2 },
    });

    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout analysis",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests pass"],
            failureHandling: ["capture logs"],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => {
            throw new Error("review failed");
          }),
        },
        verifier: {
          assess: verifierAssess,
        },
      },
      createIncrementingClock(3_000),
    );

    const result = await executor.execute({
      plan,
      filePaths: ["src/auth.ts"],
      domains: ["backend"],
    });

    expect(result.status).toBe("failed");
    expect(result.failedPhase).toBe("review");
    expect(result.completedPhases).toEqual([
      "understand",
      "design",
      "plan",
      "implement-red",
      "build-green",
      "refactor",
    ]);
    expect(result.phases).toHaveLength(7);
    expect(result.phases[6]).toMatchObject({
      phase: "review",
      status: "failed",
      error: "review failed",
    });
    expect(verifierAssess).not.toHaveBeenCalled();
  });

  it("continues execution after failures when continueOnFailure is enabled", async () => {
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-exec-3",
      query: "auth release",
      workflowMode: "static",
      complexity: { fileCount: 12, patternCount: 3 },
    });

    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout analysis",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests pass"],
            failureHandling: ["capture logs"],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => {
            throw new Error("review failed");
          }),
        },
        verifier: {
          assess: verifierAssess,
        },
      },
      createIncrementingClock(4_000),
    );

    const result = await executor.execute({
      plan,
      continueOnFailure: true,
    });

    expect(result.status).toBe("failed");
    expect(result.failedPhase).toBe("review");
    expect(result.phases).toHaveLength(9);
    expect(result.phases[6]).toMatchObject({
      phase: "review",
      status: "failed",
    });
    expect(result.phases[7]).toMatchObject({
      phase: "verify",
      status: "completed",
    });
    expect(result.phases[8]).toMatchObject({
      phase: "deliver",
      status: "completed",
    });
    expect(verifierAssess).toHaveBeenCalledTimes(2);
  });

  it("resumes from checkpoint after partial success without rerunning completed phases", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-resume-1",
      query: "resume partial run",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const scoutAnalyze = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "s1",
        relevantFiles: ["src/a.ts"],
        rankedFiles: [],
        domains: ["backend"],
        notes: [],
        risks: [],
      })
      .mockRejectedValueOnce(new Error("stop before second scout"))
      .mockResolvedValue({
        summary: "s2",
        relevantFiles: ["src/a.ts"],
        rankedFiles: [],
        domains: ["backend"],
        notes: [],
        risks: [],
      });
    const testerPlan = vi.fn(async () => ({
      summary: "tester",
      commands: ["pnpm test"],
      expectedChecks: ["tests"],
      failureHandling: ["logs"],
    }));
    const builderPlan = vi.fn(async () => ({
      summary: "builder",
      plannedChanges: ["src/a.ts"],
      risks: [],
    }));
    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: { analyze: scoutAnalyze },
        tester: { plan: testerPlan },
        builder: { plan: builderPlan },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(5_000),
      store,
    );

    const firstRun = await executor.execute({ plan });
    expect(firstRun.status).toBe("failed");
    expect(firstRun.failedPhase).toBe("plan");
    expect(firstRun.completedPhases).toEqual(["understand"]);

    const resumeRun = await executor.execute({
      resumeSessionId: "session-resume-1",
    });
    expect(resumeRun.status).toBe("completed");
    expect(resumeRun.resume.resumed).toBe(true);
    expect(resumeRun.phases.map((entry) => entry.phase)).toEqual([
      "understand",
      "plan",
      "implement-red",
      "build-green",
      "verify",
      "deliver",
    ]);
    expect(scoutAnalyze).toHaveBeenCalledTimes(3);
    expect(testerPlan).toHaveBeenCalledTimes(1);
  });

  it("resumes failed run when continueOnFailure is false", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-resume-2",
      query: "resume fail fast",
      workflowMode: "static",
      complexity: { fileCount: 9, patternCount: 3 },
    });

    const reviewerAssess = vi
      .fn()
      .mockRejectedValueOnce(new Error("review failed"))
      .mockResolvedValue({ summary: "review", findings: [] });
    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        },
        reviewer: { assess: reviewerAssess },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(6_000),
      store,
    );

    const firstRun = await executor.execute({ plan, continueOnFailure: false });
    expect(firstRun.status).toBe("failed");
    expect(firstRun.failedPhase).toBe("review");

    const resumed = await executor.execute({
      resumeSessionId: "session-resume-2",
    });
    expect(resumed.status).toBe("completed");
    expect(reviewerAssess).toHaveBeenCalledTimes(2);
    expect(verifierAssess).toHaveBeenCalledTimes(2);
  });

  it("resumes failed run with continueOnFailure enabled and preserves lineage", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-resume-3",
      query: "resume continue failure",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const verifierAssess = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "verify",
        trustScore: 1,
        threshold: 0.75,
        gateDecision: "pass" as const,
        checks: [],
        blockers: [],
      })
      .mockRejectedValueOnce(new Error("deliver failed"))
      .mockResolvedValue({
        summary: "deliver retry",
        trustScore: 1,
        threshold: 0.75,
        gateDecision: "pass" as const,
        checks: [],
        blockers: [],
      });

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(7_000),
      store,
    );

    const firstRun = await executor.execute({
      plan,
      continueOnFailure: true,
    });
    expect(firstRun.status).toBe("failed");
    expect(firstRun.failedPhase).toBe("deliver");

    const resumed = await executor.execute({
      resumeSessionId: "session-resume-3",
    });
    expect(resumed.status).toBe("completed");
    const deliver = resumed.phases.find((entry) => entry.phase === "deliver");
    const verify = resumed.phases.find((entry) => entry.phase === "verify");
    expect(deliver?.parentHandoffId).toBe(verify?.handoffId);
    expect(verifierAssess).toHaveBeenCalledTimes(3);
  });

  it("reuses completed phases from checkpoint cache on repeated execute", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-cache-1",
      query: "cache replay",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/cache.ts"],
      rankedFiles: [],
      domains: ["backend"],
      notes: [],
      risks: [],
    }));
    const testerPlan = vi.fn(async () => ({
      summary: "tester",
      commands: ["pnpm test"],
      expectedChecks: ["tests"],
      failureHandling: ["logs"],
    }));
    const builderPlan = vi.fn(async () => ({
      summary: "builder",
      plannedChanges: ["src/cache.ts"],
      risks: [],
    }));
    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: { analyze: scoutAnalyze },
        tester: { plan: testerPlan },
        builder: { plan: builderPlan },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(8_000),
      store,
    );

    const first = await executor.execute({ plan });
    expect(first.status).toBe("completed");
    expect(first.runtime.cache.hits).toBe(0);
    expect(first.runtime.cache.misses).toBe(6);

    const second = await executor.execute({ plan });
    expect(second.status).toBe("completed");
    expect(second.runtime.cache.hits).toBe(6);
    expect(second.runtime.cache.misses).toBe(0);
    expect(second.phases.every((entry) => entry.source === "cache")).toBe(true);
    expect(scoutAnalyze).toHaveBeenCalledTimes(2);
    expect(testerPlan).toHaveBeenCalledTimes(1);
    expect(builderPlan).toHaveBeenCalledTimes(1);
    expect(verifierAssess).toHaveBeenCalledTimes(2);
  });

  it("reindex replays from design stage and marks reindexed source", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-reindex-1",
      query: "reindex flow",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/reindex.ts"],
      rankedFiles: [],
      domains: ["backend"],
      notes: [],
      risks: [],
    }));
    const testerPlan = vi.fn(async () => ({
      summary: "tester",
      commands: ["pnpm test"],
      expectedChecks: ["tests"],
      failureHandling: ["logs"],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: { analyze: scoutAnalyze },
        tester: { plan: testerPlan },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/reindex.ts"],
            risks: [],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: {
          assess: vi.fn(async () => ({
            summary: "verify",
            trustScore: 1,
            threshold: 0.75,
            gateDecision: "pass" as const,
            checks: [],
            blockers: [],
          })),
        },
      },
      createIncrementingClock(9_000),
      store,
    );

    await executor.execute({ plan });
    const reindexed = await executor.execute({ plan, reindex: true });

    expect(reindexed.runtime.reindex.requested).toBe(true);
    expect(reindexed.runtime.reindex.applied).toBe(true);
    expect(
      reindexed.phases.every((entry) => entry.source === "reindexed"),
    ).toBe(true);
    expect(scoutAnalyze).toHaveBeenCalledTimes(4);
    expect(testerPlan).toHaveBeenCalledTimes(2);
  });

  it("reuses design-stage artifacts across sessions when plan shape matches", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const planA = engine.plan({
      sessionId: "session-cross-a",
      query: "cross session cache",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });
    const planB = engine.plan({
      sessionId: "session-cross-b",
      query: "cross session cache",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/cross.ts"],
      rankedFiles: [],
      domains: ["backend"],
      notes: [],
      risks: [],
    }));
    const testerPlan = vi.fn(async () => ({
      summary: "tester",
      commands: ["pnpm test"],
      expectedChecks: ["tests"],
      failureHandling: ["logs"],
    }));
    const builderPlan = vi.fn(async () => ({
      summary: "builder",
      plannedChanges: ["src/cross.ts"],
      risks: [],
    }));
    const verifierAssess = vi.fn(async () => ({
      summary: "verify",
      trustScore: 1,
      threshold: 0.75,
      gateDecision: "pass" as const,
      checks: [],
      blockers: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: { analyze: scoutAnalyze },
        tester: { plan: testerPlan },
        builder: { plan: builderPlan },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(11_000),
      store,
    );

    const first = await executor.execute({ plan: planA });
    expect(first.status).toBe("completed");
    expect(first.runtime.cache.hits).toBe(0);
    expect(first.runtime.cache.misses).toBe(6);

    const second = await executor.execute({ plan: planB });
    expect(second.status).toBe("completed");
    expect(second.runtime.cache.hits).toBe(2);
    expect(second.runtime.cache.misses).toBe(4);

    const understand = second.phases.find(
      (entry) => entry.phase === "understand",
    );
    const planPhase = second.phases.find((entry) => entry.phase === "plan");
    const implement = second.phases.find(
      (entry) => entry.phase === "implement-red",
    );
    expect(understand?.source).toBe("cache");
    expect(planPhase?.source).toBe("cache");
    expect(implement?.source).toBe("runtime");
    expect(implement?.parentHandoffId).toBe(planPhase?.handoffId);

    expect(scoutAnalyze).toHaveBeenCalledTimes(2);
    expect(testerPlan).toHaveBeenCalledTimes(2);
    expect(builderPlan).toHaveBeenCalledTimes(2);
    expect(verifierAssess).toHaveBeenCalledTimes(4);
  });

  it("does not reuse cross-session artifacts when complexity differs", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const planA = engine.plan({
      sessionId: "session-cross-complexity-a",
      query: "cross session cache complexity",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });
    const planB = engine.plan({
      sessionId: "session-cross-complexity-b",
      query: "cross session cache complexity",
      workflowMode: "quick",
      complexity: { fileCount: 2, patternCount: 1 },
    });

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/complexity.ts"],
      rankedFiles: [],
      domains: ["backend"],
      notes: [],
      risks: [],
    }));

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: { analyze: scoutAnalyze },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/complexity.ts"],
            risks: [],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: {
          assess: vi.fn(async () => ({
            summary: "verify",
            trustScore: 1,
            threshold: 0.75,
            gateDecision: "pass" as const,
            checks: [],
            blockers: [],
          })),
        },
      },
      createIncrementingClock(12_000),
      store,
    );

    await executor.execute({ plan: planA });
    const second = await executor.execute({ plan: planB });

    expect(second.runtime.cache.hits).toBe(0);
    expect(second.runtime.cache.misses).toBe(6);
    expect(second.phases.every((entry) => entry.source === "runtime")).toBe(
      true,
    );
    expect(scoutAnalyze).toHaveBeenCalledTimes(4);
  });

  it("does not reuse cache when requested hints drift from checkpoint context", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-cache-hint-drift-1",
      query: "hint drift",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/hints.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/hints.ts"],
            risks: [],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: {
          assess: vi.fn(async () => ({
            summary: "verify",
            trustScore: 1,
            threshold: 0.75,
            gateDecision: "pass" as const,
            checks: [],
            blockers: [],
          })),
        },
      },
      createIncrementingClock(13_000),
      store,
    );

    await executor.execute({
      plan,
      filePaths: ["src/hints.ts"],
      domains: ["backend"],
    });

    const driftedHints = await executor.execute({
      plan,
      filePaths: ["src/hints.ts", "src/new-hint.ts"],
      domains: ["backend", "security"],
    });

    expect(driftedHints.runtime.cache.hits).toBe(0);
    expect(driftedHints.runtime.cache.misses).toBe(6);
    expect(
      driftedHints.phases.every((entry) => entry.source === "runtime"),
    ).toBe(true);
  });

  it("preserves deterministic lineage with mixed cached and replayed phases", async () => {
    const store = new InMemoryCheckpointStore();
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "session-cache-lineage-1",
      query: "lineage replay",
      workflowMode: "quick",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    const verifierAssess = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "verify",
        trustScore: 1,
        threshold: 0.75,
        gateDecision: "pass" as const,
        checks: [],
        blockers: [],
      })
      .mockRejectedValueOnce(new Error("deliver failed"))
      .mockResolvedValue({
        summary: "deliver",
        trustScore: 1,
        threshold: 0.75,
        gateDecision: "pass" as const,
        checks: [],
        blockers: [],
      });

    const executor = new D3WorkflowExecutor(
      new ExpertOrchestrator(createIncrementingClock()),
      {
        scout: {
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        },
        tester: {
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        },
        builder: {
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        },
        reviewer: {
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        },
        verifier: { assess: verifierAssess },
      },
      createIncrementingClock(10_000),
      store,
    );

    const first = await executor.execute({ plan, continueOnFailure: true });
    expect(first.status).toBe("failed");
    expect(first.failedPhase).toBe("deliver");

    const second = await executor.execute({ plan });
    expect(second.status).toBe("completed");

    const verify = second.phases.find((entry) => entry.phase === "verify");
    const deliver = second.phases.find((entry) => entry.phase === "deliver");
    expect(verify?.source).toBe("cache");
    expect(deliver?.source).toBe("runtime");
    expect(deliver?.parentHandoffId).toBe(verify?.handoffId);
    expect(second.runtime.cache.hits).toBe(5);
    expect(second.runtime.cache.misses).toBe(1);
    expect(verifierAssess).toHaveBeenCalledTimes(3);
  });
});
