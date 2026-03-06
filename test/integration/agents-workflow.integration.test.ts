import { describe, expect, it, vi } from "vitest";

import {
  BuilderSubagent,
  ExpertOrchestrator,
  ReviewerSubagent,
  ScoutSubagent,
  TesterSubagent,
  validateAgentHandoffPayload,
  VerifierSubagent,
} from "../../src/agents/index.js";
import { createCliProgram } from "../../src/cli.js";
import {
  TOKENS,
  ServiceContainer,
  type Token,
} from "../../src/core/container.js";
import { MemoryManager } from "../../src/memory/index.js";
import { SearchEngine, type SearchHit } from "../../src/search/index.js";
import {
  D3WorkflowEngine,
  type D3WorkflowCheckpoint,
  type D3WorkflowCheckpointStore,
  type D3WorkflowPlan,
} from "../../src/workflow/index.js";

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

describe("Agent workflow integration", () => {
  it("executes expert -> scout workflow through CLI contract", async () => {
    const stageHits: SearchHit[] = [
      {
        filePath: "src/auth/service.ts",
        line: 3,
        column: 1,
        preview: "auth service token verification",
        score: 9,
      },
      {
        filePath: "src/auth/controller.ts",
        line: 12,
        column: 1,
        preview: "auth controller route",
        score: 7,
      },
    ];
    const stage = {
      searchSanitized: vi.fn().mockResolvedValue(stageHits),
    };

    const container = new ServiceContainer();
    const search = new SearchEngine({ workspaceRoot: process.cwd(), stage });
    const memory = new MemoryManager();
    memory.shared.set(
      "auth-service-policy",
      "service token verification pattern",
    );

    container.registerSingleton(
      TOKENS.SearchEngine as Token<SearchEngine>,
      () => search,
    );
    container.registerSingleton(
      TOKENS.MemoryManager as Token<MemoryManager>,
      () => memory,
    );
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_000),
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () =>
        new ScoutSubagent(
          container.resolve(TOKENS.SearchEngine as Token<SearchEngine>),
          container.resolve(TOKENS.MemoryManager as Token<MemoryManager>),
        ),
    );

    const writes: string[] = [];
    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:scout",
      "auth service",
      "--session",
      "session-e2e-1",
      "--domains",
      "backend",
      "--files",
      "src/auth/service.ts",
    ]);

    expect(stage.searchSanitized).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(writes.join("")) as {
      handoff: {
        to: string;
        sessionId: string;
        handoffId: string;
        attempt: number;
      };
      analysis: {
        relevantFiles: string[];
        rankedFiles: Array<{ filePath: string; confidence: number }>;
        notes: string[];
      };
    };

    expect(payload.handoff.to).toBe("scout");
    expect(payload.handoff.sessionId).toBe("session-e2e-1");
    expect(payload.handoff.handoffId).toMatch(/^h-scout-[a-f0-9]{16}$/);
    expect(payload.handoff.attempt).toBe(1);
    expect(payload.analysis.relevantFiles).toEqual([
      "src/auth/service.ts",
      "src/auth/controller.ts",
    ]);
    expect(
      payload.analysis.rankedFiles[0]?.confidence ?? 0,
    ).toBeGreaterThanOrEqual(payload.analysis.rankedFiles[1]?.confidence ?? 0);
    expect(payload.analysis.notes).not.toContain(
      "Memory matched 1 related entries.",
    );
  });

  it("keeps scout memory signals isolated by session id", async () => {
    const stageHits: SearchHit[] = [
      {
        filePath: "src/auth/service.ts",
        line: 3,
        column: 1,
        preview: "auth service token verification",
        score: 9,
      },
      {
        filePath: "src/auth/controller.ts",
        line: 12,
        column: 1,
        preview: "auth controller route",
        score: 7,
      },
    ];

    const search = new SearchEngine({
      workspaceRoot: process.cwd(),
      stage: { searchSanitized: vi.fn().mockResolvedValue(stageHits) },
    });

    const sessionMemory = new Map<string, string[]>([
      ["session-a", ["session auth service note"]],
      ["session-b", []],
    ]);

    const memory = {
      searchSession: vi.fn((term: string, sessionId: string, limit = 5) => {
        const notes = sessionMemory.get(sessionId) ?? [];
        return notes.slice(0, limit).map((note, index) => ({
          id: `${sessionId}-${index}`,
          scope: "session" as const,
          scopeId: sessionId,
          key: `${term}-${index}`,
          value: note,
          temperature: "hot" as const,
          createdAt: 1,
          updatedAt: 1,
          lastAccessedAt: 1,
          accessCount: 1,
        }));
      }),
    };

    const scout = new ScoutSubagent(search, memory);
    const expert = new ExpertOrchestrator(() => 1_700_000_000_300);

    const handoffA = validateAgentHandoffPayload(
      expert.createScoutHandoff({
        sessionId: "session-a",
        query: "auth service",
        filePaths: ["src/auth/service.ts"],
        domains: ["backend"],
      }),
    );
    const handoffB = validateAgentHandoffPayload(
      expert.createScoutHandoff({
        sessionId: "session-b",
        query: "auth service",
        filePaths: ["src/auth/service.ts"],
        domains: ["backend"],
      }),
    );

    const resultA = await scout.analyze({ handoff: handoffA });
    const resultB = await scout.analyze({ handoff: handoffB });

    expect(memory.searchSession).toHaveBeenNthCalledWith(
      1,
      "auth service",
      "session-a",
      5,
    );
    expect(memory.searchSession).toHaveBeenNthCalledWith(
      2,
      "auth service",
      "session-b",
      5,
    );

    expect(resultA.notes).toContain("Memory matched 1 related entries.");
    expect(resultB.notes).not.toContain("Memory matched 1 related entries.");
    expect(resultA.rankedFiles[0]?.reasons).toContain("memory hit");
    expect(resultB.rankedFiles[0]?.reasons).not.toContain("memory hit");
  });

  it("executes expert -> builder scaffold workflow through CLI contract", async () => {
    const container = new ServiceContainer();
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_100),
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () => new BuilderSubagent(),
    );

    const writes: string[] = [];
    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:builder",
      "implement auth guard",
      "--session",
      "session-e2e-2",
      "--domains",
      "backend",
      "--files",
      "src/auth/guard.ts",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      handoff: {
        to: string;
        sessionId: string;
        handoffId: string;
        attempt: number;
      };
      plan: { plannedChanges: string[]; risks: string[] };
    };

    expect(payload.handoff.to).toBe("builder");
    expect(payload.handoff.sessionId).toBe("session-e2e-2");
    expect(payload.handoff.handoffId).toMatch(/^h-builder-[a-f0-9]{16}$/);
    expect(payload.handoff.attempt).toBe(1);
    expect(payload.plan.plannedChanges).toEqual([
      "src/auth/guard.ts",
      "domain:backend",
    ]);
    expect(payload.plan.risks[0]).toContain("scaffolded");
  });

  it("executes deterministic multi-hop handoffs expert -> scout -> builder -> tester", async () => {
    const stageHits: SearchHit[] = [
      {
        filePath: "src/auth/service.ts",
        line: 1,
        column: 1,
        preview: "auth service",
        score: 8,
      },
      {
        filePath: "src/auth/controller.ts",
        line: 1,
        column: 1,
        preview: "auth controller",
        score: 7,
      },
    ];

    const search = new SearchEngine({
      workspaceRoot: process.cwd(),
      stage: { searchSanitized: vi.fn().mockResolvedValue(stageHits) },
    });
    const memory = new MemoryManager();
    const expert = new ExpertOrchestrator(() => 1_700_000_000_200);
    const scout = new ScoutSubagent(search, memory);
    const builder = new BuilderSubagent();
    const tester = new TesterSubagent();

    const scoutHandoff = validateAgentHandoffPayload(
      expert.createScoutHandoff({
        sessionId: "session-hop-1",
        query: "auth workflow",
        filePaths: ["src/auth/service.ts"],
        domains: ["backend"],
      }),
    );
    const scoutAnalysis = await scout.analyze({ handoff: scoutHandoff });

    const builderHandoff = validateAgentHandoffPayload(
      expert.createBuilderHandoff({
        sessionId: scoutHandoff.sessionId,
        query: scoutHandoff.query,
        filePaths: scoutAnalysis.relevantFiles,
        domains: scoutAnalysis.domains,
        parentHandoffId: scoutHandoff.handoffId,
        attempt: 1,
      }),
    );
    const builderPlan = await builder.plan({ handoff: builderHandoff });

    const testerHandoff = validateAgentHandoffPayload(
      expert.createTesterHandoff({
        sessionId: builderHandoff.sessionId,
        query: builderHandoff.query,
        filePaths: builderPlan.plannedChanges.filter(
          (entry) => !entry.startsWith("domain:"),
        ),
        domains: builderHandoff.domains,
        parentHandoffId: builderHandoff.handoffId,
        attempt: 1,
      }),
    );
    const testerPlan = await tester.plan({ handoff: testerHandoff });

    const pipelineSnapshot = {
      scout: {
        to: scoutHandoff.to,
        handoffId: scoutHandoff.handoffId,
        attempt: scoutHandoff.attempt,
        relevantFiles: scoutAnalysis.relevantFiles,
      },
      builder: {
        to: builderHandoff.to,
        parentHandoffId: builderHandoff.parentHandoffId,
        handoffId: builderHandoff.handoffId,
        plannedChanges: builderPlan.plannedChanges,
      },
      tester: {
        to: testerHandoff.to,
        parentHandoffId: testerHandoff.parentHandoffId,
        handoffId: testerHandoff.handoffId,
        commands: testerPlan.commands,
      },
    };

    expect(pipelineSnapshot).toEqual({
      scout: {
        to: "scout",
        handoffId: pipelineSnapshot.scout.handoffId,
        attempt: 1,
        relevantFiles: ["src/auth/service.ts", "src/auth/controller.ts"],
      },
      builder: {
        to: "builder",
        parentHandoffId: pipelineSnapshot.scout.handoffId,
        handoffId: pipelineSnapshot.builder.handoffId,
        plannedChanges: [
          "src/auth/service.ts",
          "src/auth/controller.ts",
          "domain:backend",
        ],
      },
      tester: {
        to: "tester",
        parentHandoffId: pipelineSnapshot.builder.handoffId,
        handoffId: pipelineSnapshot.tester.handoffId,
        commands: [
          "pnpm typecheck",
          "pnpm lint",
          "pnpm test",
          "pnpm test:e2e",
          "pnpm build",
          "pnpm test -- src/auth/service.ts",
          "pnpm test -- src/auth/controller.ts",
        ],
      },
    });
    expect(pipelineSnapshot.scout.handoffId).toMatch(/^h-scout-[a-f0-9]{16}$/);
    expect(pipelineSnapshot.builder.handoffId).toMatch(
      /^h-builder-[a-f0-9]{16}$/,
    );
    expect(pipelineSnapshot.tester.handoffId).toMatch(
      /^h-tester-[a-f0-9]{16}$/,
    );
  });

  it("executes and resumes D3 workflow through CLI checkpoint contract", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/auth/service.ts"],
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
      plannedChanges: ["src/auth/service.ts", "domain:backend"],
      risks: [],
    }));
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

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_700),
    );
    container.registerSingleton(
      TOKENS.D3WorkflowEngine as Token<D3WorkflowEngine>,
      () => new D3WorkflowEngine(),
    );
    container.registerSingleton(
      TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
      () => new InMemoryCheckpointStore(),
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () => ({ analyze: scoutAnalyze }) as unknown as ScoutSubagent,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => ({ plan: testerPlan }) as unknown as TesterSubagent,
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () => ({ plan: builderPlan }) as unknown as BuilderSubagent,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => ({ assess: reviewerAssess }) as unknown as ReviewerSubagent,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => ({ assess: verifierAssess }) as unknown as VerifierSubagent,
    );

    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "harden auth flow",
      "--session",
      "session-d3-resume-1",
      "--workflow",
      "static",
      "--execute",
    ]);

    const firstPayload = JSON.parse(writes.join("")) as {
      execution: {
        status: string;
        failedPhase?: string;
        resume: { resumed: boolean };
        runtime: {
          cache: { enabled: boolean; hits: number; misses: number };
          reindex: { requested: boolean; applied: boolean };
        };
      };
    };
    expect(firstPayload.execution.status).toBe("failed");
    expect(firstPayload.execution.failedPhase).toBe("review");
    expect(firstPayload.execution.resume.resumed).toBe(false);
    expect(firstPayload.execution.runtime.cache.enabled).toBe(true);
    expect(firstPayload.execution.runtime.cache.misses).toBeGreaterThan(0);

    writes.length = 0;
    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "--resume",
      "--session",
      "session-d3-resume-1",
    ]);

    const resumedPayload = JSON.parse(writes.join("")) as {
      execution: {
        status: string;
        resume: { resumed: boolean };
        runtime: {
          cache: { enabled: boolean; hits: number; misses: number };
          reindex: { requested: boolean; applied: boolean };
        };
      };
    };
    expect(resumedPayload.execution.status).toBe("completed");
    expect(resumedPayload.execution.resume.resumed).toBe(true);
    expect(resumedPayload.execution.runtime.cache.hits).toBeGreaterThan(0);
    expect(scoutAnalyze).toHaveBeenCalledTimes(3);
    expect(testerPlan).toHaveBeenCalledTimes(1);
    expect(builderPlan).toHaveBeenCalledTimes(2);
    expect(reviewerAssess).toHaveBeenCalledTimes(2);
    expect(verifierAssess).toHaveBeenCalledTimes(2);

    writes.length = 0;
    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "harden auth flow",
      "--session",
      "session-d3-resume-1",
      "--workflow",
      "static",
      "--execute",
      "--reindex",
    ]);

    const reindexPayload = JSON.parse(writes.join("")) as {
      execution: {
        runtime: {
          reindex: { requested: boolean; applied: boolean };
        };
        phases: Array<{ source: string }>;
      };
    };
    expect(reindexPayload.execution.runtime.reindex.requested).toBe(true);
    expect(reindexPayload.execution.runtime.reindex.applied).toBe(true);
    expect(
      reindexPayload.execution.phases.every(
        (phase) => phase.source === "reindexed",
      ),
    ).toBe(true);
  });

  it("reuses design-stage artifacts across sessions in CLI workflow execution", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const scoutAnalyze = vi.fn(async () => ({
      summary: "scout",
      relevantFiles: ["src/auth/service.ts"],
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
      plannedChanges: ["src/auth/service.ts", "domain:backend"],
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

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_750),
    );
    container.registerSingleton(
      TOKENS.D3WorkflowEngine as Token<D3WorkflowEngine>,
      () => new D3WorkflowEngine(),
    );
    container.registerSingleton(
      TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
      () => new InMemoryCheckpointStore(),
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () => ({ analyze: scoutAnalyze }) as unknown as ScoutSubagent,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => ({ plan: testerPlan }) as unknown as TesterSubagent,
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () => ({ plan: builderPlan }) as unknown as BuilderSubagent,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () =>
        ({
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        }) as unknown as ReviewerSubagent,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => ({ assess: verifierAssess }) as unknown as VerifierSubagent,
    );

    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "cross session cache",
      "--session",
      "session-d3-cross-a",
      "--workflow",
      "quick",
      "--execute",
    ]);
    writes.length = 0;

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "cross session cache",
      "--session",
      "session-d3-cross-b",
      "--workflow",
      "quick",
      "--execute",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      execution: {
        runtime: {
          cache: { hits: number; misses: number };
        };
        phases: Array<{
          phase: string;
          source: string;
          handoffId: string;
          parentHandoffId?: string;
        }>;
      };
    };
    expect(payload.execution.runtime.cache.hits).toBe(2);
    expect(payload.execution.runtime.cache.misses).toBe(4);
    expect(payload.execution.phases[0]?.phase).toBe("understand");
    expect(payload.execution.phases[0]?.source).toBe("cache");
    expect(payload.execution.phases[1]?.phase).toBe("plan");
    expect(payload.execution.phases[1]?.source).toBe("cache");
    expect(payload.execution.phases[2]?.phase).toBe("implement-red");
    expect(payload.execution.phases[2]?.source).toBe("runtime");
    expect(payload.execution.phases[2]?.parentHandoffId).toBe(
      payload.execution.phases[1]?.handoffId,
    );

    expect(scoutAnalyze).toHaveBeenCalledTimes(2);
    expect(testerPlan).toHaveBeenCalledTimes(2);
    expect(builderPlan).toHaveBeenCalledTimes(2);
    expect(verifierAssess).toHaveBeenCalledTimes(4);
  });

  it("executes quality path with policy-driven stage inclusion", async () => {
    const expert = new ExpertOrchestrator(() => 1_700_000_000_300);

    const result = await expert.executeQualityPath(
      {
        sessionId: "session-quality-1",
        query: "quality pipeline",
        parentHandoffId: "h-builder-parent-001",
        verifierTrustInput: {
          testPassRate: 1,
          reviewSeverity: "low",
          completeness: 1,
          evidenceQuality: 1,
        },
      },
      {
        tester: new TesterSubagent(),
        reviewer: new ReviewerSubagent(),
        verifier: new VerifierSubagent(),
      },
      {
        includeReviewer: false,
      },
    );

    expect(result.handoffs.map((handoff) => handoff.to)).toEqual([
      "tester",
      "verifier",
    ]);
    expect(result.handoffs[0]?.parentHandoffId).toBe("h-builder-parent-001");
    expect(result.handoffs[1]?.parentHandoffId).toBe(
      result.handoffs[0]?.handoffId,
    );
    expect(result.steps.map((step) => step.status)).toEqual([
      "executed",
      "executed",
    ]);
    expect(result.finalGateState.trustScore).toBe(0.95);
  });

  it("supports continue semantics for failed trust gate", async () => {
    const expert = new ExpertOrchestrator(() => 1_700_000_000_301);

    const skipResult = await expert.executeQualityPath(
      {
        sessionId: "session-quality-2",
        query: "quality pipeline",
        gateInput: { trustScore: 0.2 },
      },
      {
        tester: new TesterSubagent(),
        reviewer: new ReviewerSubagent(),
        verifier: new VerifierSubagent(),
      },
      {
        continueOnTrustGateFailure: false,
      },
    );

    expect(skipResult.steps.every((step) => step.status === "skipped")).toBe(
      true,
    );

    const continueResult = await expert.executeQualityPath(
      {
        sessionId: "session-quality-3",
        query: "quality pipeline",
        gateInput: { trustScore: 0.2 },
        verifierTrustInput: {
          testPassRate: 1,
          reviewSeverity: "low",
          completeness: 1,
          evidenceQuality: 1,
        },
      },
      {
        tester: new TesterSubagent(),
        reviewer: new ReviewerSubagent(),
        verifier: new VerifierSubagent(),
      },
      {
        continueOnTrustGateFailure: true,
      },
    );

    expect(continueResult.steps.map((step) => step.status)).toEqual([
      "executed",
      "executed",
      "executed",
    ]);
    expect(continueResult.finalGateState.trustPassed).toBe(true);
  });

  it("rejects invalid lineage and attempt during quality-path execution", async () => {
    const expert = new ExpertOrchestrator(() => 1_700_000_000_302);

    await expect(
      expert.executeQualityPath(
        {
          sessionId: "session-quality-4",
          query: "quality pipeline",
          parentHandoffId: "bad",
        },
        {
          tester: new TesterSubagent(),
          reviewer: new ReviewerSubagent(),
          verifier: new VerifierSubagent(),
        },
      ),
    ).rejects.toThrow();

    await expect(
      expert.executeQualityPath(
        {
          sessionId: "session-quality-5",
          query: "quality pipeline",
          attempt: 0,
        },
        {
          tester: new TesterSubagent(),
          reviewer: new ReviewerSubagent(),
          verifier: new VerifierSubagent(),
        },
      ),
    ).rejects.toThrow();
  });

  it("executes quality path through CLI with skip and continue semantics", async () => {
    const container = new ServiceContainer();
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_400),
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => new TesterSubagent(),
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => new ReviewerSubagent(),
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => new VerifierSubagent(),
    );

    const skipWrites: string[] = [];
    const skipProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          skipWrites.push(chunk);
          return true;
        },
      },
    });

    await skipProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-1",
      "--trust-score",
      "0.2",
    ]);

    const skipPayload = JSON.parse(skipWrites.join("")) as {
      result: { steps: Array<{ status: string; skipReason?: string }> };
    };
    expect(
      skipPayload.result.steps.every((step) => step.status === "skipped"),
    ).toBe(true);
    expect(
      skipPayload.result.steps.every(
        (step) => step.skipReason === "trust_gate",
      ),
    ).toBe(true);

    const continueWrites: string[] = [];
    const continueProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          continueWrites.push(chunk);
          return true;
        },
      },
    });

    await continueProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-2",
      "--trust-score",
      "0.2",
      "--continue-on-trust-failure",
      "--skip-reviewer",
      "--test-pass-rate",
      "1",
      "--review-severity",
      "low",
      "--completeness",
      "1",
      "--evidence-quality",
      "1",
    ]);

    const continuePayload = JSON.parse(continueWrites.join("")) as {
      policy: { includeReviewer: boolean; continueOnTrustGateFailure: boolean };
      result: {
        steps: Array<{ status: string }>;
        finalGateState: { trustPassed: boolean };
      };
    };

    expect(continuePayload.policy.includeReviewer).toBe(false);
    expect(continuePayload.policy.continueOnTrustGateFailure).toBe(true);
    expect(
      continuePayload.result.steps.every((step) => step.status === "executed"),
    ).toBe(true);
    expect(continuePayload.result.finalGateState.trustPassed).toBe(true);
  });

  it("executes quality path through CLI with fail-closed and fail-open stage failure semantics", async () => {
    const container = new ServiceContainer();
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_500),
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () =>
        ({
          plan: async () => {
            throw new Error("tester failed");
          },
        }) as TesterSubagent,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => new ReviewerSubagent(),
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => new VerifierSubagent(),
    );

    const closedWrites: string[] = [];
    const closedProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          closedWrites.push(chunk);
          return true;
        },
      },
    });

    await closedProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-fail-closed",
      "--skip-verifier",
    ]);

    const closedPayload = JSON.parse(closedWrites.join("")) as {
      result: { steps: Array<{ status: string; skipReason?: string }> };
    };
    expect(closedPayload.result.steps[0]?.skipReason).toBe("stage_failure");
    expect(closedPayload.result.steps[1]?.skipReason).toBe("stage_failure");

    const openWrites: string[] = [];
    const openProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          openWrites.push(chunk);
          return true;
        },
      },
    });

    await openProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-fail-open",
      "--continue-on-stage-failure",
      "--skip-verifier",
    ]);

    const openPayload = JSON.parse(openWrites.join("")) as {
      result: { steps: Array<{ status: string; skipReason?: string }> };
    };
    expect(openPayload.result.steps[0]?.skipReason).toBe("stage_failure");
    expect(openPayload.result.steps[1]?.status).toBe("executed");
  });

  it("executes quality path through CLI with deterministic rate-limit semantics", async () => {
    const container = new ServiceContainer();
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_600),
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => new TesterSubagent(),
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => new ReviewerSubagent(),
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => new VerifierSubagent(),
    );

    const closedWrites: string[] = [];
    const closedProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          closedWrites.push(chunk);
          return true;
        },
      },
    });

    await closedProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-rate-limit-closed",
      "--rate-limit-max-executions",
      "1",
      "--rate-limit-window-ms",
      "60000",
    ]);

    const closedPayload = JSON.parse(closedWrites.join("")) as {
      result: {
        steps: Array<{ status: string; skipReason?: string }>;
        qualitySummary: { resilience: { rateLimited: number } };
      };
    };
    expect(closedPayload.result.steps[0]?.status).toBe("executed");
    expect(closedPayload.result.steps[1]?.skipReason).toBe("rate_limited");
    expect(closedPayload.result.steps[2]?.skipReason).toBe("rate_limited");
    expect(closedPayload.result.qualitySummary.resilience.rateLimited).toBe(1);

    const openWrites: string[] = [];
    const openProgram = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          openWrites.push(chunk);
          return true;
        },
      },
    });

    await openProgram.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-rate-limit-open",
      "--rate-limit-max-executions",
      "1",
      "--rate-limit-window-ms",
      "60000",
      "--continue-on-rate-limit",
    ]);

    const openPayload = JSON.parse(openWrites.join("")) as {
      result: {
        steps: Array<{ status: string; skipReason?: string }>;
        qualitySummary: { resilience: { rateLimited: number } };
      };
    };
    expect(openPayload.result.steps[0]?.status).toBe("executed");
    expect(openPayload.result.steps[1]?.skipReason).toBe("rate_limited");
    expect(openPayload.result.steps[2]?.skipReason).toBe("rate_limited");
    expect(openPayload.result.qualitySummary.resilience.rateLimited).toBe(2);
  });

  it("executes quality path through CLI with importance/stability metadata", async () => {
    const container = new ServiceContainer();
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_700),
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => new TesterSubagent(),
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => new ReviewerSubagent(),
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => new VerifierSubagent(),
    );

    const writes: string[] = [];
    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:quality",
      "quality pipeline",
      "--session",
      "session-quality-cli-importance-stability",
      "--skip-reviewer",
      "--skip-verifier",
      "--importance",
      "5",
      "--stability",
      "2",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      policy: { importance: number; stability: number };
      result: {
        finalGateState: { importance: number; stability: number };
        qualitySummary: { importance: number; stability: number };
        steps: Array<{ gateState: { importance: number; stability: number } }>;
      };
    };

    expect(payload.policy.importance).toBe(5);
    expect(payload.policy.stability).toBe(2);
    expect(payload.result.finalGateState.importance).toBe(5);
    expect(payload.result.finalGateState.stability).toBe(2);
    expect(payload.result.qualitySummary.importance).toBe(5);
    expect(payload.result.qualitySummary.stability).toBe(2);
    expect(payload.result.steps[0]?.gateState.importance).toBe(5);
    expect(payload.result.steps[0]?.gateState.stability).toBe(2);
  });
});
