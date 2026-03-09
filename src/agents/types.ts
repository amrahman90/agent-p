import { z } from "zod";

import type { SearchRequest, SearchResponse } from "../search/index.js";
import type { MemoryEntry } from "../memory/index.js";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_QUERY_LENGTH = 500;
const MAX_FILE_PATH_LENGTH = 260;
const MAX_REASON_LENGTH = 80;
const MAX_ANALYSIS_ITEMS = 25;
const MAX_HANDOFF_ID_LENGTH = 128;
const MAX_QUALITY_REASON_CODE_LENGTH = 64;

const sessionIdSchema = z
  .string()
  .min(1)
  .max(MAX_SESSION_ID_LENGTH)
  .regex(/^[a-zA-Z0-9._:-]+$/);

const querySchema = z.string().trim().min(1).max(MAX_QUERY_LENGTH);

const filePathSchema = z
  .string()
  .min(1)
  .max(MAX_FILE_PATH_LENGTH)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code === 0 || code === 10 || code === 13;
      }),
    {
      message: "File path must not contain control characters",
    },
  )
  .refine((value) => /[\\/.]/.test(value), {
    message: "File path must include a separator or extension",
  });

const domainSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/);

const handoffIdSchema = z
  .string()
  .min(8)
  .max(MAX_HANDOFF_ID_LENGTH)
  .regex(/^[a-zA-Z0-9._:-]+$/);

const handoffAttemptSchema = z.number().int().min(1).max(10);

export const agentRoleSchema = z.enum([
  "expert",
  "scout",
  "builder",
  "tester",
  "reviewer",
  "verifier",
]);
export const handoffPrioritySchema = z.enum(["low", "normal", "high"]);
export const reviewerSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export const verifierGateDecisionSchema = z.enum(["pass", "fail"]);

export const verifierTrustInputSchema = z.object({
  testPassRate: z.number().min(0).max(1).default(0),
  reviewSeverity: reviewerSeveritySchema.default("low"),
  completeness: z.number().min(0).max(1).default(0),
  evidenceQuality: z.number().min(0).max(1).default(0),
  coverage: z.number().min(0).max(1).optional(),
  reproducibility: z.number().min(0).max(1).optional(),
});

export const dangerousPatternCategorySchema = z.enum([
  "prompt_injection",
  "secret_exfiltration",
  "destructive_command",
]);

export const qualityReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_QUALITY_REASON_CODE_LENGTH)
  .regex(/^[a-z][a-z0-9_:-]*$/);

export const agentFileConfidenceSchema = z.object({
  filePath: filePathSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1).max(120)).default([]),
});

export const agentHandoffAnalysisSchema = z.object({
  summary: z.string().min(1).max(300),
  relevantFiles: z.array(filePathSchema).max(MAX_ANALYSIS_ITEMS).default([]),
  rankedFiles: z
    .array(agentFileConfidenceSchema)
    .max(MAX_ANALYSIS_ITEMS)
    .default([]),
  domains: z.array(domainSchema).max(MAX_ANALYSIS_ITEMS).default([]),
  notes: z
    .array(z.string().min(1).max(200))
    .max(MAX_ANALYSIS_ITEMS)
    .default([]),
  risks: z
    .array(z.string().min(1).max(200))
    .max(MAX_ANALYSIS_ITEMS)
    .default([]),
});

export const agentHandoffPayloadSchema = z.object({
  from: agentRoleSchema,
  to: agentRoleSchema,
  sessionId: sessionIdSchema,
  handoffId: handoffIdSchema,
  parentHandoffId: handoffIdSchema.optional(),
  attempt: handoffAttemptSchema,
  query: querySchema,
  filePaths: z.array(filePathSchema).max(MAX_ANALYSIS_ITEMS).default([]),
  domains: z.array(domainSchema).max(MAX_ANALYSIS_ITEMS).default([]),
  analysis: agentHandoffAnalysisSchema.optional(),
  metadata: z.object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REASON_LENGTH)
      .regex(/^[a-z][a-z0-9_:-]*$/),
    priority: handoffPrioritySchema,
    timestamp: z.number().int().nonnegative().safe(),
  }),
});

export type AgentRole = z.infer<typeof agentRoleSchema>;
export type HandoffPriority = z.infer<typeof handoffPrioritySchema>;
export type AgentFileConfidence = z.infer<typeof agentFileConfidenceSchema>;
export type AgentHandoffAnalysis = z.infer<typeof agentHandoffAnalysisSchema>;
export type AgentHandoffPayload = z.infer<typeof agentHandoffPayloadSchema>;
export type ReviewerSeverity = z.infer<typeof reviewerSeveritySchema>;
export type VerifierGateDecision = z.infer<typeof verifierGateDecisionSchema>;
export type VerifierTrustInput = z.infer<typeof verifierTrustInputSchema>;
export type DangerousPatternCategory = z.infer<
  typeof dangerousPatternCategorySchema
>;
export type QualityReasonCode = z.infer<typeof qualityReasonCodeSchema>;

export interface DangerousPatternMatch {
  readonly category: DangerousPatternCategory;
  readonly reasonCode: QualityReasonCode;
  readonly indicator: string;
  readonly source: "query" | "analysis";
}

export interface ExpertPlanningRequest {
  readonly sessionId: string;
  readonly handoffId?: string;
  readonly parentHandoffId?: string;
  readonly attempt?: number;
  readonly query: string;
  readonly filePaths?: readonly string[];
  readonly domains?: readonly string[];
  readonly reason?: string;
  readonly priority?: HandoffPriority;
}

export interface ExpertQualityCompositionPolicy {
  readonly includeTester?: boolean;
  readonly includeReviewer?: boolean;
  readonly includeVerifier?: boolean;
}

export interface ExpertQualityGateInput {
  readonly trustScore?: number;
  readonly goalCompletion?: number;
}

export interface ExpertQualityExecutionPolicy extends ExpertQualityCompositionPolicy {
  readonly importance?: number;
  readonly stability?: number;
  readonly enforceTrustGate?: boolean;
  readonly enforceGoalGate?: boolean;
  readonly minTrustScore?: number;
  readonly minGoalCompletion?: number;
  readonly continueOnTrustGateFailure?: boolean;
  readonly continueOnGoalGateFailure?: boolean;
  readonly stageTimeoutMs?: number;
  readonly maxStageRetries?: number;
  readonly continueOnStageFailure?: boolean;
  readonly continueOnStageTimeout?: boolean;
  readonly circuitBreakerFailureThreshold?: number;
  readonly rateLimitMaxExecutions?: number;
  readonly rateLimitWindowMs?: number;
  readonly continueOnRateLimit?: boolean;
}

export interface ExpertQualityExecutionRequest extends ExpertPlanningRequest {
  readonly gateInput?: ExpertQualityGateInput;
  readonly verifierTrustInput?: Partial<VerifierTrustInput>;
}

export interface ExpertQualitySubagents {
  readonly tester: {
    plan(request: TesterPlanningRequest): Promise<TesterPlanningResult>;
  };
  readonly reviewer: {
    assess(
      request: ReviewerAssessmentRequest,
    ): Promise<ReviewerAssessmentResult>;
  };
  readonly verifier: {
    assess(
      request: VerifierAssessmentRequest,
    ): Promise<VerifierAssessmentResult>;
  };
}

export interface ExpertQualityGateState {
  readonly trustScore: number;
  readonly goalCompletion: number;
  readonly importance: number;
  readonly stability: number;
  readonly trustPassed: boolean;
  readonly goalPassed: boolean;
}

export type ExpertQualitySkipReason =
  | "trust_gate"
  | "goal_gate"
  | "stage_failure"
  | "stage_timeout"
  | "circuit_open"
  | "rate_limited";

export type ExpertQualityHopResult =
  | TesterPlanningResult
  | ReviewerAssessmentResult
  | VerifierAssessmentResult;

export interface ExpertQualityExecutionStep {
  readonly handoff: AgentHandoffPayload;
  readonly status: "executed" | "skipped";
  readonly gateState: ExpertQualityGateState;
  readonly skipReason?: ExpertQualitySkipReason;
  readonly result?: ExpertQualityHopResult;
  readonly attempts?: number;
  readonly durationMs?: number;
  readonly failureReasonCode?: QualityReasonCode;
}

export interface ExpertQualityResilienceSummary {
  readonly retries: number;
  readonly failures: number;
  readonly timeouts: number;
  readonly circuitOpen: boolean;
  readonly rateLimited: number;
}

export interface ExpertQualitySummary {
  readonly importance: number;
  readonly stability: number;
  readonly reasonCodes: readonly QualityReasonCode[];
  readonly dangerousPatterns: readonly DangerousPatternMatch[];
  readonly resilience: ExpertQualityResilienceSummary;
}

export interface ExpertQualityExecutionResult {
  readonly handoffs: readonly AgentHandoffPayload[];
  readonly steps: readonly ExpertQualityExecutionStep[];
  readonly finalGateState: ExpertQualityGateState;
  readonly qualitySummary: ExpertQualitySummary;
}

export interface ScoutAnalysisRequest {
  readonly handoff: AgentHandoffPayload;
}

export type ScoutAnalysisResult = AgentHandoffAnalysis;

export interface BuilderPlanningRequest {
  readonly handoff: AgentHandoffPayload;
}

export interface BuilderPlanningResult {
  readonly summary: string;
  readonly plannedChanges: readonly string[];
  readonly risks: readonly string[];
}

export interface TesterPlanningRequest {
  readonly handoff: AgentHandoffPayload;
}

export interface TesterPlanningResult {
  readonly summary: string;
  readonly commands: readonly string[];
  readonly expectedChecks: readonly string[];
  readonly failureHandling: readonly string[];
}

export interface ReviewerAssessmentRequest {
  readonly handoff: AgentHandoffPayload;
}

export interface ReviewerFinding {
  readonly severity: ReviewerSeverity;
  readonly finding: string;
  readonly recommendedFix: string;
  readonly reasonCode?: QualityReasonCode;
}

export interface ReviewerAssessmentResult {
  readonly summary: string;
  readonly findings: readonly ReviewerFinding[];
}

export interface VerifierAssessmentRequest {
  readonly handoff: AgentHandoffPayload;
  readonly trustInput?: Partial<VerifierTrustInput>;
}

export interface VerifierAssessmentResult {
  readonly summary: string;
  readonly trustScore: number;
  readonly threshold: number;
  readonly gateDecision: VerifierGateDecision;
  readonly checks: readonly string[];
  readonly blockers: readonly string[];
  readonly reasonCodes?: readonly QualityReasonCode[];
}

export interface ScoutSearchService {
  query(request: SearchRequest): Promise<SearchResponse>;
}

export interface ScoutMemoryService {
  searchSession(term: string, sessionId: string, limit?: number): MemoryEntry[];
}

/**
 * Validates and parses an agent handoff payload.
 * @param payload - The unknown payload to validate
 * @returns The validated agent handoff payload
 * @example
 * ```typescript
 * const payload = validateAgentHandoffPayload({
 *   from: "expert",
 *   to: "scout",
 *   sessionId: "session-123",
 *   handoffId: "h-scout-abc123",
 *   attempt: 1,
 *   query: "Find files related to authentication",
 *   metadata: { reason: "context_discovery", priority: "normal", timestamp: Date.now() }
 * });
 * ```
 */
export const validateAgentHandoffPayload = (
  payload: unknown,
): AgentHandoffPayload => agentHandoffPayloadSchema.parse(payload);
