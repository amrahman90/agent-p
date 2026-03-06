import {
  type AgentHandoffAnalysis,
  type AgentHandoffPayload,
  type BuilderPlanningResult,
  ExpertOrchestrator,
  type ReviewerAssessmentResult,
  type ScoutAnalysisResult,
  type TesterPlanningResult,
  validateAgentHandoffPayload,
  type VerifierAssessmentResult,
  type VerifierTrustInput,
} from "../agents/index.js";
import type { D3WorkflowCheckpointStore } from "./checkpoint-store.js";
import type {
  D3WorkflowCheckpoint,
  D3WorkflowCheckpointStatus,
  D3WorkflowExecutionRequest,
  D3WorkflowExecutionResult,
  D3WorkflowPhase,
  D3WorkflowPhaseArtifact,
  D3WorkflowPhaseExecutionResult,
  D3WorkflowPlan,
  D3WorkflowReindexRuntimeMetadata,
  D3WorkflowRuntimeContext,
  D3WorkflowRuntimeMetadata,
} from "./types.js";

type Clock = () => number;

interface D3WorkflowRuntimeSubagents {
  readonly scout: {
    analyze(request: {
      handoff: AgentHandoffPayload;
    }): Promise<ScoutAnalysisResult>;
  };
  readonly builder: {
    plan(request: {
      handoff: AgentHandoffPayload;
    }): Promise<BuilderPlanningResult>;
  };
  readonly tester: {
    plan(request: {
      handoff: AgentHandoffPayload;
    }): Promise<TesterPlanningResult>;
  };
  readonly reviewer: {
    assess(request: {
      handoff: AgentHandoffPayload;
    }): Promise<ReviewerAssessmentResult>;
  };
  readonly verifier: {
    assess(request: {
      handoff: AgentHandoffPayload;
      trustInput?: Partial<VerifierTrustInput>;
    }): Promise<VerifierAssessmentResult>;
  };
}

const dedupe = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const extractBuilderFilePaths = (
  result: BuilderPlanningResult,
): readonly string[] =>
  result.plannedChanges.filter(
    (entry): entry is string => !entry.startsWith("domain:"),
  );

const upsertPhaseResult = (
  phaseResults: D3WorkflowPhaseExecutionResult[],
  nextResult: D3WorkflowPhaseExecutionResult,
): void => {
  const existingIndex = phaseResults.findIndex(
    (entry) => entry.order === nextResult.order,
  );

  if (existingIndex >= 0) {
    phaseResults[existingIndex] = nextResult;
  } else {
    phaseResults.push(nextResult);
  }

  phaseResults.sort((left, right) => left.order - right.order);
};

const computeCompletedPhases = (
  phaseResults: readonly D3WorkflowPhaseExecutionResult[],
): D3WorkflowPhase[] =>
  phaseResults
    .filter((entry) => entry.status === "completed")
    .map((entry) => entry.phase);

const computeFailures = (
  phaseResults: readonly D3WorkflowPhaseExecutionResult[],
): D3WorkflowPhaseExecutionResult[] =>
  phaseResults.filter((entry) => entry.status === "failed");

const normalizePhaseResult = (
  phaseResult: D3WorkflowPhaseExecutionResult,
): D3WorkflowPhaseExecutionResult => ({
  ...phaseResult,
  cacheHit: phaseResult.cacheHit ?? false,
  source: phaseResult.source ?? "runtime",
});

const sortByOrder = (
  phaseResults: readonly D3WorkflowPhaseExecutionResult[],
): D3WorkflowPhaseExecutionResult[] =>
  [...phaseResults].sort((left, right) => left.order - right.order);

const hasHintDrift = (
  requested: readonly string[],
  available: readonly string[],
): boolean => {
  if (requested.length === 0) {
    return false;
  }

  const availableSet = new Set(available);
  return requested.some((entry) => !availableSet.has(entry));
};

const deriveReindexMetadata = (input: {
  requested: boolean;
  plan: D3WorkflowPlan;
}): D3WorkflowReindexRuntimeMetadata => {
  if (!input.requested) {
    return { requested: false, applied: false };
  }

  const firstDesignPhase = input.plan.phases.find(
    (phasePlan) => phasePlan.stage === "design",
  );
  if (!firstDesignPhase) {
    return { requested: true, applied: false };
  }

  return {
    requested: true,
    applied: false,
    startPhaseOrder: firstDesignPhase.order,
    startPhase: firstDesignPhase.phase,
  };
};

const defaultRuntimeMetadata = (input: {
  useCache: boolean;
  reindexRequested: boolean;
  plan: D3WorkflowPlan;
}): D3WorkflowRuntimeMetadata => ({
  cache: {
    enabled: input.useCache,
    hits: 0,
    misses: 0,
  },
  reindex: deriveReindexMetadata({
    requested: input.reindexRequested,
    plan: input.plan,
  }),
});

const nextPhaseOrderFromPlan = (
  plan: D3WorkflowPlan,
  phaseResults: readonly D3WorkflowPhaseExecutionResult[],
): number => {
  for (const phasePlan of plan.phases) {
    const prior = phaseResults.find((entry) => entry.order === phasePlan.order);
    if (prior?.status !== "completed") {
      return phasePlan.order;
    }
  }

  return plan.phases.length + 1;
};

const checkpointStatusFor = (
  plan: D3WorkflowPlan,
  phaseResults: readonly D3WorkflowPhaseExecutionResult[],
): D3WorkflowCheckpointStatus => {
  const failures = computeFailures(phaseResults);
  const nextPhaseOrder = nextPhaseOrderFromPlan(plan, phaseResults);

  if (nextPhaseOrder > plan.phases.length) {
    return failures.length === 0 ? "completed" : "failed";
  }

  return "in_progress";
};

export class D3WorkflowExecutor {
  constructor(
    private readonly expert: ExpertOrchestrator,
    private readonly subagents: D3WorkflowRuntimeSubagents,
    private readonly clock: Clock = Date.now,
    private readonly checkpointStore?: D3WorkflowCheckpointStore,
  ) {}

  async execute(
    request: D3WorkflowExecutionRequest,
  ): Promise<D3WorkflowExecutionResult> {
    if (request.resumeSessionId !== undefined) {
      return this.resumeFromCheckpoint(request);
    }

    if (request.plan === undefined) {
      throw new Error("Workflow execution requires a plan for non-resume runs");
    }

    const continueOnFailure = request.continueOnFailure ?? false;
    const useCache = request.useCache ?? true;
    const requestFilePaths = dedupe(request.filePaths ?? []);
    const requestDomains = dedupe(request.domains ?? []);
    const runtime = defaultRuntimeMetadata({
      useCache,
      reindexRequested: request.reindex ?? false,
      plan: request.plan,
    });
    let phaseResults: D3WorkflowPhaseExecutionResult[] = [];
    let context: D3WorkflowRuntimeContext = {
      filePaths: requestFilePaths,
      domains: requestDomains,
    };

    if (this.checkpointStore && useCache) {
      const cachedCheckpoint = this.resolveReusableCheckpoint({
        plan: request.plan,
        requestFilePaths,
        requestDomains,
      });
      if (cachedCheckpoint) {
        const normalizedCachedPhases = sortByOrder(cachedCheckpoint.phases).map(
          normalizePhaseResult,
        );
        const sameSession =
          cachedCheckpoint.sessionId === request.plan.sessionId;
        const cacheEligiblePhases = sameSession
          ? normalizedCachedPhases
          : this.selectCrossSessionPlanningPhases({
              plan: request.plan,
              phaseResults: normalizedCachedPhases,
            });
        phaseResults = this.applyReindexPolicy({
          phaseResults: cacheEligiblePhases,
          reindex: runtime.reindex,
          runtime,
        });

        const seededContext = sameSession
          ? cachedCheckpoint.context
          : this.rebuildContextFromPhaseArtifacts({
              plan: request.plan,
              phaseResults,
              context,
            });
        context = {
          ...seededContext,
          filePaths: dedupe([...seededContext.filePaths, ...context.filePaths]),
          domains: dedupe([...seededContext.domains, ...context.domains]),
        };
      }
    }

    return this.executeInternal({
      plan: request.plan,
      phaseResults,
      context,
      continueOnFailure,
      resumed: false,
      runtime,
      ...(request.verifierTrustInput !== undefined
        ? { verifierTrustInput: request.verifierTrustInput }
        : {}),
    });
  }

  private async resumeFromCheckpoint(
    request: D3WorkflowExecutionRequest,
  ): Promise<D3WorkflowExecutionResult> {
    if (!this.checkpointStore) {
      throw new Error("Workflow checkpoint store is not configured");
    }

    const sessionId = request.resumeSessionId;
    if (sessionId === undefined) {
      throw new Error("Missing resume session identifier");
    }

    const checkpoint = this.checkpointStore.load(sessionId);
    if (!checkpoint) {
      throw new Error(
        `No workflow checkpoint found for session '${sessionId}'`,
      );
    }

    const useCache = request.useCache ?? true;
    const runtime = defaultRuntimeMetadata({
      useCache,
      reindexRequested: request.reindex ?? false,
      plan: checkpoint.plan,
    });
    const phaseResults = sortByOrder(checkpoint.phases).map(
      normalizePhaseResult,
    );
    const nextPhaseResults = this.applyReindexPolicy({
      phaseResults,
      reindex: runtime.reindex,
      runtime,
    });

    return this.executeInternal({
      plan: checkpoint.plan,
      phaseResults: nextPhaseResults,
      context: checkpoint.context,
      continueOnFailure:
        request.continueOnFailure ?? checkpoint.continueOnFailure,
      resumed: true,
      runtime,
      ...(request.verifierTrustInput !== undefined
        ? { verifierTrustInput: request.verifierTrustInput }
        : {}),
    });
  }

  private async executeInternal(input: {
    plan: D3WorkflowPlan;
    phaseResults: D3WorkflowPhaseExecutionResult[];
    context: D3WorkflowRuntimeContext;
    continueOnFailure: boolean;
    runtime: D3WorkflowRuntimeMetadata;
    verifierTrustInput?: Partial<VerifierTrustInput>;
    resumed: boolean;
  }): Promise<D3WorkflowExecutionResult> {
    const orderedPlans = [...input.plan.phases].sort(
      (left, right) => left.order - right.order,
    );

    let currentFilePaths = dedupe(input.context.filePaths);
    let currentDomains = dedupe(input.context.domains);
    let currentAnalysis = input.context.analysis;
    let parentHandoffId = input.context.parentHandoffId;

    for (const phasePlan of orderedPlans) {
      const prior = input.phaseResults.find(
        (entry) => entry.order === phasePlan.order,
      );
      const reindexedPhase =
        input.runtime.reindex.requested &&
        input.runtime.reindex.startPhaseOrder !== undefined &&
        phasePlan.order >= input.runtime.reindex.startPhaseOrder;
      if (prior?.status === "completed") {
        const cachedPrior: D3WorkflowPhaseExecutionResult = {
          ...prior,
          cacheHit: true,
          source:
            input.runtime.reindex.requested &&
            input.runtime.reindex.startPhaseOrder !== undefined &&
            prior.order >= input.runtime.reindex.startPhaseOrder
              ? "reindexed"
              : "cache",
        };
        upsertPhaseResult(input.phaseResults, cachedPrior);
        input.runtime.cache.hits += 1;
        parentHandoffId = prior.handoffId;
        if (prior.artifact !== undefined) {
          const updated = this.updateContextFromArtifact({
            phase: prior.phase,
            artifact: prior.artifact,
            currentFilePaths,
            currentDomains,
            ...(currentAnalysis !== undefined ? { currentAnalysis } : {}),
          });
          currentFilePaths = updated.filePaths;
          currentDomains = updated.domains;
          currentAnalysis = updated.analysis;
        }
        continue;
      }

      const startedAt = this.clock();
      let handoffForPhase: AgentHandoffPayload | undefined;

      try {
        const handoff = this.createPhaseHandoff({
          phase: phasePlan.phase,
          sessionId: input.plan.sessionId,
          query: input.plan.query,
          filePaths: currentFilePaths,
          domains: currentDomains,
          attempt: phasePlan.order,
          ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
          ...(currentAnalysis !== undefined
            ? { analysis: currentAnalysis }
            : {}),
        });
        handoffForPhase = handoff;

        const artifact = await this.executePhase(
          phasePlan.phase,
          handoff,
          input.verifierTrustInput,
        );

        const endedAt = this.clock();
        upsertPhaseResult(input.phaseResults, {
          order: phasePlan.order,
          stage: phasePlan.stage,
          phase: phasePlan.phase,
          agent: phasePlan.agent,
          status: "completed",
          startedAt,
          endedAt,
          handoffId: handoff.handoffId,
          ...(handoff.parentHandoffId !== undefined
            ? { parentHandoffId: handoff.parentHandoffId }
            : {}),
          cacheHit: false,
          source: reindexedPhase ? "reindexed" : "runtime",
          ...(reindexedPhase ? { reindexApplied: true } : {}),
          artifact,
        });
        if (reindexedPhase) {
          input.runtime.reindex.applied = true;
        }
        input.runtime.cache.misses += 1;

        const updated = this.updateContextFromArtifact({
          phase: phasePlan.phase,
          artifact,
          currentFilePaths,
          currentDomains,
          ...(currentAnalysis !== undefined ? { currentAnalysis } : {}),
        });
        currentFilePaths = updated.filePaths;
        currentDomains = updated.domains;
        currentAnalysis = updated.analysis;
        parentHandoffId = handoff.handoffId;

        this.saveCheckpoint({
          plan: input.plan,
          continueOnFailure: input.continueOnFailure,
          phaseResults: input.phaseResults,
          context: {
            filePaths: currentFilePaths,
            domains: currentDomains,
            ...(currentAnalysis !== undefined
              ? { analysis: currentAnalysis }
              : {}),
            ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
          },
          runtime: input.runtime,
        });
      } catch (error: unknown) {
        const endedAt = this.clock();
        upsertPhaseResult(input.phaseResults, {
          order: phasePlan.order,
          stage: phasePlan.stage,
          phase: phasePlan.phase,
          agent: phasePlan.agent,
          status: "failed",
          startedAt,
          endedAt,
          handoffId: handoffForPhase?.handoffId ?? `failed-${phasePlan.order}`,
          ...(handoffForPhase?.parentHandoffId !== undefined
            ? { parentHandoffId: handoffForPhase.parentHandoffId }
            : {}),
          cacheHit: false,
          source: reindexedPhase ? "reindexed" : "runtime",
          ...(reindexedPhase ? { reindexApplied: true } : {}),
          error: toErrorMessage(error),
        });
        if (reindexedPhase) {
          input.runtime.reindex.applied = true;
        }
        input.runtime.cache.misses += 1;

        this.saveCheckpoint({
          plan: input.plan,
          continueOnFailure: input.continueOnFailure,
          phaseResults: input.phaseResults,
          context: {
            filePaths: currentFilePaths,
            domains: currentDomains,
            ...(currentAnalysis !== undefined
              ? { analysis: currentAnalysis }
              : {}),
            ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
          },
          runtime: input.runtime,
        });

        if (!input.continueOnFailure) {
          break;
        }
      }
    }

    const failures = computeFailures(input.phaseResults);
    const failedPhase = failures[0]?.phase;
    const completedPhases = computeCompletedPhases(input.phaseResults);
    const checkpointStatus = checkpointStatusFor(
      input.plan,
      input.phaseResults,
    );
    const nextPhaseOrder = nextPhaseOrderFromPlan(
      input.plan,
      input.phaseResults,
    );

    this.saveCheckpoint({
      plan: input.plan,
      continueOnFailure: input.continueOnFailure,
      phaseResults: input.phaseResults,
      context: {
        filePaths: currentFilePaths,
        domains: currentDomains,
        ...(currentAnalysis !== undefined ? { analysis: currentAnalysis } : {}),
        ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
      },
      runtime: input.runtime,
    });

    return {
      sessionId: input.plan.sessionId,
      query: input.plan.query,
      workflowMode: input.plan.workflowMode,
      effectiveWorkflowMode: input.plan.effectiveWorkflowMode,
      analysisMode: input.plan.analysisMode,
      status: failedPhase === undefined ? "completed" : "failed",
      phases: input.phaseResults,
      completedPhases,
      failures,
      resume: {
        resumed: input.resumed,
        sessionId: input.plan.sessionId,
        nextPhaseOrder,
        checkpointStatus,
      },
      runtime: input.runtime,
      ...(failedPhase !== undefined ? { failedPhase } : {}),
    };
  }

  private saveCheckpoint(input: {
    plan: D3WorkflowPlan;
    continueOnFailure: boolean;
    phaseResults: readonly D3WorkflowPhaseExecutionResult[];
    context: D3WorkflowRuntimeContext;
    runtime: D3WorkflowRuntimeMetadata;
  }): void {
    if (!this.checkpointStore) {
      return;
    }

    const checkpoint: D3WorkflowCheckpoint = {
      sessionId: input.plan.sessionId,
      plan: input.plan,
      continueOnFailure: input.continueOnFailure,
      nextPhaseOrder: nextPhaseOrderFromPlan(input.plan, input.phaseResults),
      phases: [...input.phaseResults],
      failures: computeFailures(input.phaseResults),
      context: input.context,
      runtime: input.runtime,
      status: checkpointStatusFor(input.plan, input.phaseResults),
      updatedAt: this.clock(),
    };

    this.checkpointStore.save(checkpoint);
  }

  private isReusableCheckpoint(
    checkpoint: D3WorkflowCheckpoint,
    plan: D3WorkflowPlan,
    requestHints: {
      filePaths: readonly string[];
      domains: readonly string[];
    },
  ): boolean {
    const samePhaseShape =
      checkpoint.plan.phases.length === plan.phases.length &&
      checkpoint.plan.phases.every(
        (phase, index) =>
          phase.order === plan.phases[index]?.order &&
          phase.stage === plan.phases[index]?.stage &&
          phase.phase === plan.phases[index]?.phase &&
          phase.agent === plan.phases[index]?.agent,
      );

    const sameSkippedPhases =
      checkpoint.plan.skippedPhases.length === plan.skippedPhases.length &&
      checkpoint.plan.skippedPhases.every(
        (phase, index) => phase === plan.skippedPhases[index],
      );

    const sameComplexity =
      checkpoint.plan.complexity.fileCount === plan.complexity.fileCount &&
      checkpoint.plan.complexity.patternCount === plan.complexity.patternCount;

    const hasFilePathDrift = hasHintDrift(
      requestHints.filePaths,
      checkpoint.context.filePaths,
    );
    const hasDomainDrift = hasHintDrift(
      requestHints.domains,
      checkpoint.context.domains,
    );

    return (
      checkpoint.plan.query === plan.query &&
      checkpoint.plan.workflowMode === plan.workflowMode &&
      checkpoint.plan.effectiveWorkflowMode === plan.effectiveWorkflowMode &&
      checkpoint.plan.analysisMode === plan.analysisMode &&
      sameComplexity &&
      samePhaseShape &&
      sameSkippedPhases &&
      !hasFilePathDrift &&
      !hasDomainDrift
    );
  }

  private resolveReusableCheckpoint(input: {
    plan: D3WorkflowPlan;
    requestFilePaths: readonly string[];
    requestDomains: readonly string[];
  }): D3WorkflowCheckpoint | undefined {
    if (!this.checkpointStore) {
      return undefined;
    }

    const sameSession = this.checkpointStore.load(input.plan.sessionId);
    if (
      sameSession &&
      this.isReusableCheckpoint(sameSession, input.plan, {
        filePaths: input.requestFilePaths,
        domains: input.requestDomains,
      })
    ) {
      return sameSession;
    }

    const crossSession = this.checkpointStore.loadReusable?.(input.plan);
    if (
      crossSession &&
      this.isReusableCheckpoint(crossSession, input.plan, {
        filePaths: input.requestFilePaths,
        domains: input.requestDomains,
      })
    ) {
      return crossSession;
    }

    return undefined;
  }

  private selectCrossSessionPlanningPhases(input: {
    plan: D3WorkflowPlan;
    phaseResults: readonly D3WorkflowPhaseExecutionResult[];
  }): D3WorkflowPhaseExecutionResult[] {
    const designOrders = new Set(
      input.plan.phases
        .filter((phasePlan) => phasePlan.stage === "design")
        .map((phasePlan) => phasePlan.order),
    );

    return input.phaseResults.filter(
      (phaseResult) =>
        phaseResult.status === "completed" &&
        designOrders.has(phaseResult.order),
    );
  }

  private applyReindexPolicy(input: {
    phaseResults: readonly D3WorkflowPhaseExecutionResult[];
    reindex: D3WorkflowReindexRuntimeMetadata;
    runtime: D3WorkflowRuntimeMetadata;
  }): D3WorkflowPhaseExecutionResult[] {
    if (
      !input.reindex.requested ||
      input.reindex.startPhaseOrder === undefined
    ) {
      return [...input.phaseResults];
    }

    const startPhaseOrder = input.reindex.startPhaseOrder;
    const filtered = input.phaseResults.filter(
      (entry) => entry.order < startPhaseOrder,
    );
    input.runtime.reindex.applied =
      filtered.length < input.phaseResults.length ||
      input.runtime.reindex.applied;
    return filtered;
  }

  private updateContextFromArtifact(input: {
    phase: D3WorkflowPhase;
    artifact: D3WorkflowPhaseArtifact;
    currentFilePaths: readonly string[];
    currentDomains: readonly string[];
    currentAnalysis?: AgentHandoffAnalysis;
  }): {
    filePaths: string[];
    domains: string[];
    analysis?: AgentHandoffAnalysis;
  } {
    if (
      input.phase === "understand" ||
      input.phase === "design" ||
      input.phase === "plan"
    ) {
      const analysis = input.artifact as ScoutAnalysisResult;
      return {
        filePaths: dedupe([
          ...input.currentFilePaths,
          ...analysis.relevantFiles,
        ]),
        domains: dedupe([...input.currentDomains, ...analysis.domains]),
        analysis,
      };
    }

    if (input.phase === "build-green" || input.phase === "refactor") {
      const builderResult = input.artifact as BuilderPlanningResult;
      return {
        filePaths: dedupe([
          ...input.currentFilePaths,
          ...extractBuilderFilePaths(builderResult),
        ]),
        domains: dedupe([...input.currentDomains]),
        ...(input.currentAnalysis !== undefined
          ? { analysis: input.currentAnalysis }
          : {}),
      };
    }

    return {
      filePaths: dedupe([...input.currentFilePaths]),
      domains: dedupe([...input.currentDomains]),
      ...(input.currentAnalysis !== undefined
        ? { analysis: input.currentAnalysis }
        : {}),
    };
  }

  private rebuildContextFromPhaseArtifacts(input: {
    plan: D3WorkflowPlan;
    phaseResults: readonly D3WorkflowPhaseExecutionResult[];
    context: D3WorkflowRuntimeContext;
  }): D3WorkflowRuntimeContext {
    let filePaths = dedupe(input.context.filePaths);
    let domains = dedupe(input.context.domains);
    let analysis = input.context.analysis;
    let parentHandoffId = input.context.parentHandoffId;

    const planByOrder = new Map(
      input.plan.phases.map((phasePlan) => [phasePlan.order, phasePlan]),
    );

    for (const phaseResult of sortByOrder(input.phaseResults)) {
      const phasePlan = planByOrder.get(phaseResult.order);
      if (!phasePlan || phaseResult.artifact === undefined) {
        continue;
      }

      const updated = this.updateContextFromArtifact({
        phase: phasePlan.phase,
        artifact: phaseResult.artifact,
        currentFilePaths: filePaths,
        currentDomains: domains,
        ...(analysis !== undefined ? { currentAnalysis: analysis } : {}),
      });
      filePaths = updated.filePaths;
      domains = updated.domains;
      analysis = updated.analysis;
      parentHandoffId = phaseResult.handoffId;
    }

    return {
      filePaths,
      domains,
      ...(analysis !== undefined ? { analysis } : {}),
      ...(parentHandoffId !== undefined ? { parentHandoffId } : {}),
    };
  }

  private createPhaseHandoff(input: {
    phase: D3WorkflowPhase;
    sessionId: string;
    query: string;
    filePaths: readonly string[];
    domains: readonly string[];
    parentHandoffId?: string;
    attempt: number;
    analysis?: AgentHandoffAnalysis;
  }): AgentHandoffPayload {
    const planningRequest = {
      sessionId: input.sessionId,
      query: input.query,
      filePaths: input.filePaths,
      domains: input.domains,
      attempt: input.attempt,
      ...(input.parentHandoffId !== undefined
        ? { parentHandoffId: input.parentHandoffId }
        : {}),
    };

    const handoff = (() => {
      if (
        input.phase === "understand" ||
        input.phase === "design" ||
        input.phase === "plan"
      ) {
        return this.expert.createScoutHandoff(planningRequest);
      }

      if (input.phase === "implement-red") {
        return this.expert.createTesterHandoff(planningRequest);
      }

      if (input.phase === "build-green" || input.phase === "refactor") {
        return this.expert.createBuilderHandoff(planningRequest);
      }

      if (input.phase === "review") {
        return this.expert.createReviewerHandoff(planningRequest);
      }

      return this.expert.createVerifierHandoff(planningRequest);
    })();

    const enriched =
      input.analysis === undefined
        ? handoff
        : { ...handoff, analysis: input.analysis };

    return validateAgentHandoffPayload(enriched);
  }

  private async executePhase(
    phase: D3WorkflowPhase,
    handoff: AgentHandoffPayload,
    verifierTrustInput?: Partial<VerifierTrustInput>,
  ): Promise<D3WorkflowPhaseArtifact> {
    if (phase === "understand" || phase === "design" || phase === "plan") {
      return this.subagents.scout.analyze({ handoff });
    }

    if (phase === "implement-red") {
      return this.subagents.tester.plan({ handoff });
    }

    if (phase === "build-green" || phase === "refactor") {
      return this.subagents.builder.plan({ handoff });
    }

    if (phase === "review") {
      return this.subagents.reviewer.assess({ handoff });
    }

    return this.subagents.verifier.assess({
      handoff,
      ...(verifierTrustInput !== undefined
        ? { trustInput: verifierTrustInput }
        : {}),
    });
  }
}
