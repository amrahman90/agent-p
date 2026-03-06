import { z } from "zod";

import {
  agentFileConfidenceSchema,
  qualityReasonCodeSchema,
  reviewerSeveritySchema,
  verifierGateDecisionSchema,
  type AgentHandoffAnalysis,
  type BuilderPlanningResult,
  type ReviewerAssessmentResult,
  type ScoutAnalysisResult,
  type TesterPlanningResult,
  type VerifierAssessmentResult,
} from "../agents/types.js";

export type D3WorkflowMode = "static" | "dynamic" | "quick";

export type D3AnalysisMode = "quick" | "deep";

export type D3WorkflowStage = "design" | "develop" | "deliver";

export type D3WorkflowPhase =
  | "understand"
  | "design"
  | "plan"
  | "implement-red"
  | "build-green"
  | "refactor"
  | "review"
  | "verify"
  | "deliver";

export interface D3WorkflowEngineConfig {
  readonly defaultMode: D3WorkflowMode;
  readonly staticOverride: boolean;
  readonly quickThreshold: number;
  readonly deepFileThreshold: number;
  readonly deepPatternThreshold: number;
}

export interface D3WorkflowComplexityInput {
  readonly fileCount: number;
  readonly patternCount: number;
}

export interface D3WorkflowPlanRequest {
  readonly sessionId: string;
  readonly query: string;
  readonly workflowMode?: D3WorkflowMode;
  readonly analysisMode?: D3AnalysisMode;
  readonly filePaths?: readonly string[];
  readonly domains?: readonly string[];
  readonly complexity?: Partial<D3WorkflowComplexityInput>;
}

export interface D3WorkflowPhasePlan {
  readonly order: number;
  readonly stage: D3WorkflowStage;
  readonly phase: D3WorkflowPhase;
  readonly agent: "scout" | "builder" | "tester" | "reviewer" | "verifier";
  readonly objective: string;
}

export interface D3WorkflowPlan {
  readonly sessionId: string;
  readonly query: string;
  readonly workflowMode: D3WorkflowMode;
  readonly effectiveWorkflowMode: Exclude<D3WorkflowMode, "dynamic">;
  readonly analysisMode: D3AnalysisMode;
  readonly complexity: D3WorkflowComplexityInput;
  readonly phases: readonly D3WorkflowPhasePlan[];
  readonly skippedPhases: readonly D3WorkflowPhase[];
}

export interface D3WorkflowState {
  readonly sessionId: string;
  readonly currentPhase: D3WorkflowPhase;
  readonly completedPhases: readonly D3WorkflowPhase[];
  readonly remainingPhases: readonly D3WorkflowPhase[];
}

export interface D3WorkflowExecutionRequest {
  readonly plan?: D3WorkflowPlan;
  readonly resumeSessionId?: string;
  readonly filePaths?: readonly string[];
  readonly domains?: readonly string[];
  readonly continueOnFailure?: boolean;
  readonly useCache?: boolean;
  readonly reindex?: boolean;
  readonly verifierTrustInput?: Partial<{
    readonly testPassRate: number;
    readonly reviewSeverity: "low" | "medium" | "high" | "critical";
    readonly completeness: number;
    readonly evidenceQuality: number;
    readonly coverage: number;
    readonly reproducibility: number;
  }>;
}

export interface D3WorkflowRuntimeContext {
  readonly filePaths: readonly string[];
  readonly domains: readonly string[];
  readonly analysis?: AgentHandoffAnalysis;
  readonly parentHandoffId?: string;
}

export interface D3WorkflowCacheRuntimeMetadata {
  enabled: boolean;
  hits: number;
  misses: number;
}

export interface D3WorkflowReindexRuntimeMetadata {
  requested: boolean;
  applied: boolean;
  startPhaseOrder?: number;
  startPhase?: D3WorkflowPhase;
}

export interface D3WorkflowRuntimeMetadata {
  readonly cache: D3WorkflowCacheRuntimeMetadata;
  readonly reindex: D3WorkflowReindexRuntimeMetadata;
}

export type D3WorkflowCheckpointStatus = "in_progress" | "completed" | "failed";

export interface D3WorkflowCheckpoint {
  readonly sessionId: string;
  readonly plan: D3WorkflowPlan;
  readonly continueOnFailure: boolean;
  readonly nextPhaseOrder: number;
  readonly phases: readonly D3WorkflowPhaseExecutionResult[];
  readonly failures: readonly D3WorkflowPhaseExecutionResult[];
  readonly context: D3WorkflowRuntimeContext;
  readonly runtime: D3WorkflowRuntimeMetadata;
  readonly status: D3WorkflowCheckpointStatus;
  readonly updatedAt: number;
}

export interface D3WorkflowResumeMetadata {
  readonly resumed: boolean;
  readonly sessionId: string;
  readonly nextPhaseOrder: number;
  readonly checkpointStatus: D3WorkflowCheckpointStatus;
}

export interface D3WorkflowPhaseExecutionResult {
  readonly order: number;
  readonly stage: D3WorkflowStage;
  readonly phase: D3WorkflowPhase;
  readonly agent: "scout" | "builder" | "tester" | "reviewer" | "verifier";
  readonly status: "completed" | "failed";
  readonly startedAt: number;
  readonly endedAt: number;
  readonly handoffId: string;
  readonly parentHandoffId?: string;
  readonly cacheHit: boolean;
  readonly source: "runtime" | "cache" | "reindexed";
  readonly reindexApplied?: boolean;
  readonly artifact?: D3WorkflowPhaseArtifact;
  readonly error?: string;
}

export type D3WorkflowPhaseArtifact =
  | ScoutAnalysisResult
  | BuilderPlanningResult
  | TesterPlanningResult
  | ReviewerAssessmentResult
  | VerifierAssessmentResult;

export interface D3WorkflowExecutionResult {
  readonly sessionId: string;
  readonly query: string;
  readonly workflowMode: D3WorkflowMode;
  readonly effectiveWorkflowMode: Exclude<D3WorkflowMode, "dynamic">;
  readonly analysisMode: D3AnalysisMode;
  readonly status: "completed" | "failed";
  readonly phases: readonly D3WorkflowPhaseExecutionResult[];
  readonly completedPhases: readonly D3WorkflowPhase[];
  readonly failures: readonly D3WorkflowPhaseExecutionResult[];
  readonly failedPhase?: D3WorkflowPhase;
  readonly resume: D3WorkflowResumeMetadata;
  readonly runtime: D3WorkflowRuntimeMetadata;
}

const d3WorkflowModeSchema = z.enum(["static", "dynamic", "quick"]);
const d3AnalysisModeSchema = z.enum(["quick", "deep"]);
const d3WorkflowStageSchema = z.enum(["design", "develop", "deliver"]);
const d3WorkflowPhaseSchema = z.enum([
  "understand",
  "design",
  "plan",
  "implement-red",
  "build-green",
  "refactor",
  "review",
  "verify",
  "deliver",
]);

const d3ComplexityInputSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  patternCount: z.number().int().nonnegative(),
});

const d3WorkflowPhasePlanSchema = z.object({
  order: z.number().int().positive(),
  stage: d3WorkflowStageSchema,
  phase: d3WorkflowPhaseSchema,
  agent: z.enum(["scout", "builder", "tester", "reviewer", "verifier"]),
  objective: z.string().trim().min(1),
});

const checkpointScoutAnalysisSchema = z.object({
  summary: z.string().min(1).max(300),
  relevantFiles: z.array(z.string().min(1).max(260)),
  rankedFiles: z.array(agentFileConfidenceSchema),
  domains: z.array(z.string().trim().min(2).max(32)),
  notes: z.array(z.string().min(1).max(200)),
  risks: z.array(z.string().min(1).max(200)),
});

export const d3WorkflowPlanSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  query: z.string().trim().min(1).max(500),
  workflowMode: d3WorkflowModeSchema,
  effectiveWorkflowMode: z.enum(["static", "quick"]),
  analysisMode: d3AnalysisModeSchema,
  complexity: d3ComplexityInputSchema,
  phases: z.array(d3WorkflowPhasePlanSchema),
  skippedPhases: z.array(d3WorkflowPhaseSchema),
});

const builderPlanningResultSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  plannedChanges: z.array(z.string().min(1).max(260)),
  risks: z.array(z.string().min(1).max(200)),
});

const testerPlanningResultSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  commands: z.array(z.string().min(1).max(400)),
  expectedChecks: z.array(z.string().min(1).max(200)),
  failureHandling: z.array(z.string().min(1).max(200)),
});

const reviewerFindingSchema = z.object({
  severity: reviewerSeveritySchema,
  finding: z.string().min(1).max(400),
  recommendedFix: z.string().min(1).max(400),
  reasonCode: qualityReasonCodeSchema.optional(),
});

const reviewerAssessmentResultSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  findings: z.array(reviewerFindingSchema),
});

const verifierAssessmentResultSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  trustScore: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  gateDecision: verifierGateDecisionSchema,
  checks: z.array(z.string().min(1).max(200)),
  blockers: z.array(z.string().min(1).max(200)),
  reasonCodes: z.array(qualityReasonCodeSchema).optional(),
});

export const d3WorkflowPhaseArtifactSchema = z.union([
  checkpointScoutAnalysisSchema,
  builderPlanningResultSchema,
  testerPlanningResultSchema,
  reviewerAssessmentResultSchema,
  verifierAssessmentResultSchema,
]);

export const d3WorkflowRuntimeContextSchema = z.object({
  filePaths: z.array(z.string().min(1).max(260)),
  domains: z.array(z.string().trim().min(1).max(32)),
  analysis: checkpointScoutAnalysisSchema.optional(),
  parentHandoffId: z.string().min(1).max(128).optional(),
});

const d3WorkflowCacheRuntimeMetadataSchema = z.object({
  enabled: z.boolean(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
});

const d3WorkflowReindexRuntimeMetadataSchema = z.object({
  requested: z.boolean(),
  applied: z.boolean(),
  startPhaseOrder: z.number().int().positive().optional(),
  startPhase: d3WorkflowPhaseSchema.optional(),
});

export const d3WorkflowRuntimeMetadataSchema = z.object({
  cache: d3WorkflowCacheRuntimeMetadataSchema,
  reindex: d3WorkflowReindexRuntimeMetadataSchema,
});

export const d3WorkflowPhaseExecutionResultSchema = z.object({
  order: z.number().int().positive(),
  stage: d3WorkflowStageSchema,
  phase: d3WorkflowPhaseSchema,
  agent: z.enum(["scout", "builder", "tester", "reviewer", "verifier"]),
  status: z.enum(["completed", "failed"]),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  handoffId: z.string().min(1).max(128),
  parentHandoffId: z.string().min(1).max(128).optional(),
  cacheHit: z.boolean(),
  source: z.enum(["runtime", "cache", "reindexed"]),
  reindexApplied: z.boolean().optional(),
  artifact: d3WorkflowPhaseArtifactSchema.optional(),
  error: z.string().trim().min(1).max(500).optional(),
});

const phaseArtifactSchemaByPhase: Record<D3WorkflowPhase, z.ZodTypeAny> = {
  understand: checkpointScoutAnalysisSchema,
  design: checkpointScoutAnalysisSchema,
  plan: checkpointScoutAnalysisSchema,
  "implement-red": testerPlanningResultSchema,
  "build-green": builderPlanningResultSchema,
  refactor: builderPlanningResultSchema,
  review: reviewerAssessmentResultSchema,
  verify: verifierAssessmentResultSchema,
  deliver: verifierAssessmentResultSchema,
};

export const d3WorkflowCheckpointSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(128),
    plan: d3WorkflowPlanSchema,
    continueOnFailure: z.boolean(),
    nextPhaseOrder: z.number().int().positive(),
    phases: z.array(d3WorkflowPhaseExecutionResultSchema),
    failures: z.array(d3WorkflowPhaseExecutionResultSchema),
    context: d3WorkflowRuntimeContextSchema,
    runtime: d3WorkflowRuntimeMetadataSchema,
    status: z.enum(["in_progress", "completed", "failed"]),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((checkpoint, ctx) => {
    const maxAllowedNextOrder = checkpoint.plan.phases.length + 1;
    if (checkpoint.nextPhaseOrder > maxAllowedNextOrder) {
      ctx.addIssue({
        code: "custom",
        path: ["nextPhaseOrder"],
        message: "nextPhaseOrder exceeds plan phase count",
      });
    }

    for (const [index, phaseResult] of checkpoint.phases.entries()) {
      if (phaseResult.artifact === undefined) {
        continue;
      }

      const phaseSchema = phaseArtifactSchemaByPhase[phaseResult.phase];
      const parsed = phaseSchema.safeParse(phaseResult.artifact);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["phases", index, "artifact"],
          message: `artifact does not match expected shape for phase '${phaseResult.phase}'`,
        });
      }
    }
  });

export const parseD3WorkflowCheckpoint = (
  checkpoint: unknown,
): D3WorkflowCheckpoint =>
  d3WorkflowCheckpointSchema.parse(checkpoint) as D3WorkflowCheckpoint;
