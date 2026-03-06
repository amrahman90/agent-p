import type {
  D3AnalysisMode,
  D3WorkflowComplexityInput,
  D3WorkflowEngineConfig,
  D3WorkflowMode,
  D3WorkflowPhase,
  D3WorkflowPhasePlan,
  D3WorkflowPlan,
  D3WorkflowPlanRequest,
  D3WorkflowState,
} from "./types.js";

const DEFAULT_ENGINE_CONFIG: D3WorkflowEngineConfig = {
  defaultMode: "dynamic",
  staticOverride: true,
  quickThreshold: 3,
  deepFileThreshold: 15,
  deepPatternThreshold: 4,
};

const PHASE_METADATA: Record<
  D3WorkflowPhase,
  Pick<D3WorkflowPhasePlan, "stage" | "agent" | "objective">
> = {
  understand: {
    stage: "design",
    agent: "scout",
    objective: "Gather context and constraints",
  },
  design: {
    stage: "design",
    agent: "scout",
    objective: "Define architecture and interfaces",
  },
  plan: {
    stage: "design",
    agent: "scout",
    objective: "Break work into implementable tasks",
  },
  "implement-red": {
    stage: "develop",
    agent: "tester",
    objective: "Write failing tests first (RED)",
  },
  "build-green": {
    stage: "develop",
    agent: "builder",
    objective: "Implement minimal code to pass tests (GREEN)",
  },
  refactor: {
    stage: "develop",
    agent: "builder",
    objective: "Refactor for readability and maintainability",
  },
  review: {
    stage: "deliver",
    agent: "reviewer",
    objective: "Run multi-perspective review panel",
  },
  verify: {
    stage: "deliver",
    agent: "verifier",
    objective: "Execute end-to-end verification",
  },
  deliver: {
    stage: "deliver",
    agent: "verifier",
    objective: "Produce release-ready deliverables",
  },
};

const STATIC_PHASES: readonly D3WorkflowPhase[] = [
  "understand",
  "design",
  "plan",
  "implement-red",
  "build-green",
  "refactor",
  "review",
  "verify",
  "deliver",
];

const QUICK_PHASES: readonly D3WorkflowPhase[] = [
  "understand",
  "plan",
  "implement-red",
  "build-green",
  "verify",
  "deliver",
];

const clampNonNegativeInt = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const collectPatternCount = (query: string): number => {
  const matches = query.match(/[A-Za-z0-9._/-]+/g) ?? [];
  return new Set(matches.map((value) => value.toLowerCase())).size;
};

export class D3WorkflowEngine {
  private readonly config: D3WorkflowEngineConfig;

  constructor(config: Partial<D3WorkflowEngineConfig> = {}) {
    this.config = {
      ...DEFAULT_ENGINE_CONFIG,
      ...config,
    };
  }

  plan(request: D3WorkflowPlanRequest): D3WorkflowPlan {
    const complexity = this.resolveComplexity(request);
    const workflowMode = this.resolveWorkflowMode(request.workflowMode);
    const effectiveWorkflowMode = this.resolveEffectiveWorkflowMode(
      workflowMode,
      complexity,
    );
    const analysisMode =
      request.analysisMode ?? this.resolveAnalysisMode(complexity);
    const phases = this.resolvePhases(effectiveWorkflowMode);
    const skippedPhases = STATIC_PHASES.filter(
      (phase) => !phases.includes(phase),
    );

    return {
      sessionId: request.sessionId,
      query: request.query,
      workflowMode,
      effectiveWorkflowMode,
      analysisMode,
      complexity,
      phases: phases.map((phase, index) => ({
        order: index + 1,
        phase,
        ...PHASE_METADATA[phase],
      })),
      skippedPhases,
    };
  }

  initialState(plan: D3WorkflowPlan): D3WorkflowState {
    const [first, ...rest] = plan.phases.map((entry) => entry.phase);
    if (first === undefined) {
      throw new Error("Workflow plan has no executable phases");
    }

    return {
      sessionId: plan.sessionId,
      currentPhase: first,
      completedPhases: [],
      remainingPhases: rest,
    };
  }

  advanceState(
    state: D3WorkflowState,
    targetPhase: D3WorkflowPhase,
  ): D3WorkflowState {
    const nextPhase = state.remainingPhases[0];
    if (nextPhase === undefined) {
      throw new Error("Workflow is already complete");
    }

    if (targetPhase !== nextPhase) {
      throw new Error(
        `Invalid phase transition from '${state.currentPhase}' to '${targetPhase}'`,
      );
    }

    const [, ...remaining] = state.remainingPhases;
    return {
      sessionId: state.sessionId,
      currentPhase: targetPhase,
      completedPhases: [...state.completedPhases, state.currentPhase],
      remainingPhases: remaining,
    };
  }

  private resolveComplexity(
    request: D3WorkflowPlanRequest,
  ): D3WorkflowComplexityInput {
    const fileCount =
      request.complexity?.fileCount ?? request.filePaths?.length ?? 0;
    const patternCount =
      request.complexity?.patternCount ?? collectPatternCount(request.query);

    return {
      fileCount: clampNonNegativeInt(fileCount),
      patternCount: clampNonNegativeInt(patternCount),
    };
  }

  private resolveWorkflowMode(
    mode: D3WorkflowMode | undefined,
  ): D3WorkflowMode {
    if (mode === "static" && !this.config.staticOverride) {
      return this.config.defaultMode;
    }

    return mode ?? this.config.defaultMode;
  }

  private resolveEffectiveWorkflowMode(
    workflowMode: D3WorkflowMode,
    complexity: D3WorkflowComplexityInput,
  ): "static" | "quick" {
    if (workflowMode === "static") {
      return "static";
    }

    if (workflowMode === "quick") {
      return "quick";
    }

    return complexity.fileCount < this.config.quickThreshold &&
      complexity.patternCount < this.config.quickThreshold
      ? "quick"
      : "static";
  }

  private resolveAnalysisMode(
    complexity: D3WorkflowComplexityInput,
  ): D3AnalysisMode {
    if (
      complexity.fileCount >= this.config.deepFileThreshold ||
      complexity.patternCount >= this.config.deepPatternThreshold
    ) {
      return "deep";
    }

    return "quick";
  }

  private resolvePhases(
    mode: Exclude<D3WorkflowMode, "dynamic">,
  ): readonly D3WorkflowPhase[] {
    if (mode === "quick") {
      return QUICK_PHASES;
    }

    return STATIC_PHASES;
  }
}
