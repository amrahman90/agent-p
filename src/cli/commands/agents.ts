import { Command } from "commander";

import {
  BuilderSubagent,
  DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY,
  ExpertOrchestrator,
  ReviewerSubagent,
  ScoutSubagent,
  TesterSubagent,
  validateAgentHandoffPayload,
  VerifierSubagent,
} from "../../agents/index.js";
import type { ExpertQualityExecutionPolicy } from "../../agents/index.js";
import type { Container, Token } from "../../core/container.js";
import { TOKENS } from "../../core/container.js";
import { loadConfig } from "../../config/load-config.js";
import {
  D3WorkflowEngine,
  D3WorkflowExecutor,
  FileD3WorkflowCheckpointStore,
  type D3AnalysisMode,
  type D3WorkflowCheckpointStore,
  type D3WorkflowMode,
} from "../../workflow/index.js";
import {
  estimateTokens,
  buildVerifierTrustInput,
  createCliHelpers,
} from "../helpers.js";
import {
  parsePositiveInteger,
  parseNonNegativeInteger,
  parseProbability,
  parseScale1to5,
  parseWorkflowMode,
  parseAnalysisMode,
} from "../parsers.js";

export interface AgentsScoutOptions {
  domains?: string[];
  files?: string[];
  session?: string;
}

export interface AgentsBuilderOptions {
  domains?: string[];
  files?: string[];
  session?: string;
}

export interface AgentsTesterOptions {
  domains?: string[];
  files?: string[];
  session?: string;
}

export interface AgentsReviewerOptions {
  domains?: string[];
  files?: string[];
  session?: string;
}

export interface AgentsQualityOptions {
  domains?: string[];
  files?: string[];
  session?: string;
  parentHandoff?: string;
  attempt?: number;
  skipTester?: boolean;
  skipReviewer?: boolean;
  skipVerifier?: boolean;
  importance?: number;
  stability?: number;
  trustScore?: number;
  goalCompletion?: number;
  minTrustScore?: number;
  minGoalCompletion?: number;
  continueOnTrustFailure?: boolean;
  continueOnGoalFailure?: boolean;
  continueOnStageFailure?: boolean;
  continueOnStageTimeout?: boolean;
  stageTimeoutMs?: number;
  maxStageRetries?: number;
  circuitBreakerFailureThreshold?: number;
  rateLimitMaxExecutions?: number;
  rateLimitWindowMs?: number;
  continueOnRateLimit?: boolean;
  testPassRate?: number;
  reviewSeverity?: "low" | "medium" | "high" | "critical";
  completeness?: number;
  evidenceQuality?: number;
  coverage?: number;
  reproducibility?: number;
}

export interface AgentsWorkflowOptions {
  session?: string;
  domains?: string[];
  files?: string[];
  execute?: boolean;
  resume?: boolean;
  cache?: boolean;
  reindex?: boolean;
  continueOnFailure?: boolean;
  workflow?: D3WorkflowMode;
  mode?: D3AnalysisMode;
  fileCount?: number;
  patternCount?: number;
}

export interface AgentsVerifierOptions {
  domains?: string[];
  files?: string[];
  session?: string;
  testPassRate?: number;
  reviewSeverity?: "low" | "medium" | "high" | "critical";
  completeness?: number;
  evidenceQuality?: number;
  coverage?: number;
  reproducibility?: number;
}

export interface AgentCommands {
  register: (program: Command) => void;
}

export const createAgentCommands = (options: {
  container: Container;
  stdout: Pick<NodeJS.WriteStream, "write">;
  telemetryTracker?: unknown;
  progressReports?: unknown;
}): AgentCommands => {
  const container = options.container;
  const stdout = options.stdout;
  const helpers = createCliHelpers({
    telemetryTracker: options.telemetryTracker as never,
    progressReports: options.progressReports as never,
  });

  const register = (program: Command): void => {
    program
      .command("agents:scout <query>")
      .description("Run scout context discovery for a query")
      .option("-d, --domains <domain...>", "Domains to include in handoff")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .action(async (query: string, cmdOptions: AgentsScoutOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const scout = container.resolve(
          TOKENS.ScoutSubagent as Token<ScoutSubagent>,
        );

        const expertStartedAt = Date.now();
        const handoff = expert.createScoutHandoff({
          sessionId,
          query,
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const scoutStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const analysis = await scout.analyze({ handoff: validatedHandoff });
          success = true;

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          helpers.recordAgentExecution({
            sessionId,
            agentId: "scout",
            success: true,
            durationMs: Math.max(0, Date.now() - scoutStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(analysis),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify(
              { handoff: validatedHandoff, analysis },
              null,
              2,
            )}\n`,
          );
        } finally {
          if (!success) {
            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            helpers.recordAgentExecution({
              sessionId,
              agentId: "scout",
              success: false,
              durationMs: Math.max(0, Date.now() - scoutStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      });

    program
      .command("agents:builder <query>")
      .description("Run builder planning scaffold for a query")
      .option("-d, --domains <domain...>", "Domains to include in handoff")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .action(async (query: string, cmdOptions: AgentsBuilderOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const builder = container.resolve(
          TOKENS.BuilderSubagent as Token<BuilderSubagent>,
        );

        const expertStartedAt = Date.now();
        const handoff = expert.createBuilderHandoff({
          sessionId,
          query,
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const builderStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const plan = await builder.plan({ handoff: validatedHandoff });
          success = true;

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          helpers.recordAgentExecution({
            sessionId,
            agentId: "builder",
            success: true,
            durationMs: Math.max(0, Date.now() - builderStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(plan),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ handoff: validatedHandoff, plan }, null, 2)}\n`,
          );
        } finally {
          if (!success) {
            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            helpers.recordAgentExecution({
              sessionId,
              agentId: "builder",
              success: false,
              durationMs: Math.max(0, Date.now() - builderStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      });

    program
      .command("agents:tester <query>")
      .description("Run tester planning scaffold for a query")
      .option("-d, --domains <domain...>", "Domains to include in handoff")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .action(async (query: string, cmdOptions: AgentsTesterOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const tester = container.resolve(
          TOKENS.TesterSubagent as Token<TesterSubagent>,
        );

        const expertStartedAt = Date.now();
        const handoff = expert.createTesterHandoff({
          sessionId,
          query,
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const testerStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const plan = await tester.plan({ handoff: validatedHandoff });
          success = true;

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          helpers.recordAgentExecution({
            sessionId,
            agentId: "tester",
            success: true,
            durationMs: Math.max(0, Date.now() - testerStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(plan),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ handoff: validatedHandoff, plan }, null, 2)}\n`,
          );
        } finally {
          if (!success) {
            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            helpers.recordAgentExecution({
              sessionId,
              agentId: "tester",
              success: false,
              durationMs: Math.max(0, Date.now() - testerStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      });

    program
      .command("agents:reviewer <query>")
      .description("Run reviewer scaffold assessment for a query")
      .option("-d, --domains <domain...>", "Domains to include in handoff")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .action(async (query: string, cmdOptions: AgentsReviewerOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const reviewer = container.resolve(
          TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
        );

        const expertStartedAt = Date.now();
        const handoff = expert.createReviewerHandoff({
          sessionId,
          query,
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const reviewerStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const assessment = await reviewer.assess({
            handoff: validatedHandoff,
          });
          success = true;

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          helpers.recordAgentExecution({
            sessionId,
            agentId: "reviewer",
            success: true,
            durationMs: Math.max(0, Date.now() - reviewerStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(assessment),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify(
              { handoff: validatedHandoff, assessment },
              null,
              2,
            )}\n`,
          );
        } finally {
          if (!success) {
            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            helpers.recordAgentExecution({
              sessionId,
              agentId: "reviewer",
              success: false,
              durationMs: Math.max(0, Date.now() - reviewerStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      });

    program
      .command("agents:quality <query>")
      .description("Execute tester/reviewer/verifier quality path")
      .option("-d, --domains <domain...>", "Domains to include in handoffs")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .option("--parent-handoff <handoffId>", "Parent handoff id")
      .option(
        "--attempt <count>",
        "Lifecycle attempt number propagated to quality handoffs",
        parsePositiveInteger,
      )
      .option("--skip-tester", "Skip tester stage")
      .option("--skip-reviewer", "Skip reviewer stage")
      .option("--skip-verifier", "Skip verifier stage")
      .option(
        "--importance <value>",
        "Importance score (1..5) attached to quality execution metadata",
        parseScale1to5,
      )
      .option(
        "--stability <value>",
        "Stability score (1..5) attached to quality execution metadata",
        parseScale1to5,
      )
      .option(
        "--trust-score <value>",
        "Initial trust score gate input (0..1)",
        parseProbability,
      )
      .option(
        "--goal-completion <value>",
        "Initial goal completion gate input (0..1)",
        parseProbability,
      )
      .option(
        "--min-trust-score <value>",
        "Trust gate threshold (0..1)",
        parseProbability,
      )
      .option(
        "--min-goal-completion <value>",
        "Goal gate threshold (0..1)",
        parseProbability,
      )
      .option("--continue-on-trust-failure", "Continue on trust gate failure")
      .option("--continue-on-goal-failure", "Continue on goal gate failure")
      .option("--continue-on-stage-failure", "Continue after stage failure")
      .option("--continue-on-stage-timeout", "Continue after stage timeout")
      .option(
        "--stage-timeout-ms <value>",
        "Per-stage timeout in milliseconds",
        parsePositiveInteger,
      )
      .option(
        "--max-stage-retries <count>",
        "Maximum retries per stage after initial attempt",
        parseNonNegativeInteger,
      )
      .option(
        "--circuit-breaker-failure-threshold <count>",
        "Consecutive stage failures before opening circuit",
        parsePositiveInteger,
      )
      .option(
        "--rate-limit-max-executions <count>",
        "Max quality stage attempts allowed per rate-limit window (0 disables)",
        parseNonNegativeInteger,
      )
      .option(
        "--rate-limit-window-ms <value>",
        "Rate-limit window in milliseconds",
        parsePositiveInteger,
      )
      .option("--continue-on-rate-limit", "Continue after rate-limited stage")
      .option(
        "--test-pass-rate <value>",
        "Verifier trust input: test pass rate (0..1)",
        parseProbability,
      )
      .option(
        "--review-severity <severity>",
        "Verifier trust input: review severity (low|medium|high|critical)",
      )
      .option(
        "--completeness <value>",
        "Verifier trust input: evidence completeness (0..1)",
        parseProbability,
      )
      .option(
        "--evidence-quality <value>",
        "Verifier trust input: evidence quality (0..1)",
        parseProbability,
      )
      .option(
        "--coverage <value>",
        "Verifier trust input: coverage (0..1)",
        parseProbability,
      )
      .option(
        "--reproducibility <value>",
        "Verifier trust input: reproducibility (0..1)",
        parseProbability,
      )
      .action(async (query: string, cmdOptions: AgentsQualityOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const qualityStartedAt = Date.now();
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const tester = container.resolve(
          TOKENS.TesterSubagent as Token<TesterSubagent>,
        );
        const reviewer = container.resolve(
          TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
        );
        const verifier = container.resolve(
          TOKENS.VerifierSubagent as Token<VerifierSubagent>,
        );

        const trustInput = buildVerifierTrustInput(cmdOptions);

        const policy: ExpertQualityExecutionPolicy = {
          ...DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY,
          ...(cmdOptions.skipTester ? { includeTester: false } : {}),
          ...(cmdOptions.skipReviewer ? { includeReviewer: false } : {}),
          ...(cmdOptions.skipVerifier ? { includeVerifier: false } : {}),
          ...(cmdOptions.importance !== undefined
            ? { importance: cmdOptions.importance }
            : {}),
          ...(cmdOptions.stability !== undefined
            ? { stability: cmdOptions.stability }
            : {}),
          ...(cmdOptions.minTrustScore !== undefined
            ? { minTrustScore: cmdOptions.minTrustScore }
            : {}),
          ...(cmdOptions.minGoalCompletion !== undefined
            ? { minGoalCompletion: cmdOptions.minGoalCompletion }
            : {}),
          ...(cmdOptions.continueOnTrustFailure
            ? { continueOnTrustGateFailure: true }
            : {}),
          ...(cmdOptions.continueOnGoalFailure
            ? { continueOnGoalGateFailure: true }
            : {}),
          ...(cmdOptions.continueOnStageFailure
            ? { continueOnStageFailure: true }
            : {}),
          ...(cmdOptions.continueOnStageTimeout
            ? { continueOnStageTimeout: true }
            : {}),
          ...(cmdOptions.stageTimeoutMs !== undefined
            ? { stageTimeoutMs: cmdOptions.stageTimeoutMs }
            : {}),
          ...(cmdOptions.maxStageRetries !== undefined
            ? { maxStageRetries: cmdOptions.maxStageRetries }
            : {}),
          ...(cmdOptions.circuitBreakerFailureThreshold !== undefined
            ? {
                circuitBreakerFailureThreshold:
                  cmdOptions.circuitBreakerFailureThreshold,
              }
            : {}),
          ...(cmdOptions.rateLimitMaxExecutions !== undefined
            ? { rateLimitMaxExecutions: cmdOptions.rateLimitMaxExecutions }
            : {}),
          ...(cmdOptions.rateLimitWindowMs !== undefined
            ? { rateLimitWindowMs: cmdOptions.rateLimitWindowMs }
            : {}),
          ...(cmdOptions.continueOnRateLimit
            ? { continueOnRateLimit: true }
            : {}),
        };

        const result = await expert.executeQualityPath(
          {
            sessionId,
            query,
            ...(cmdOptions.files !== undefined
              ? { filePaths: cmdOptions.files }
              : {}),
            ...(cmdOptions.domains !== undefined
              ? { domains: cmdOptions.domains }
              : {}),
            ...(cmdOptions.parentHandoff !== undefined
              ? { parentHandoffId: cmdOptions.parentHandoff }
              : {}),
            ...(cmdOptions.attempt !== undefined
              ? { attempt: cmdOptions.attempt }
              : {}),
            ...(cmdOptions.trustScore !== undefined ||
            cmdOptions.goalCompletion !== undefined
              ? {
                  gateInput: {
                    ...(cmdOptions.trustScore !== undefined
                      ? { trustScore: cmdOptions.trustScore }
                      : {}),
                    ...(cmdOptions.goalCompletion !== undefined
                      ? { goalCompletion: cmdOptions.goalCompletion }
                      : {}),
                  },
                }
              : {}),
            ...(Object.keys(trustInput).length > 0
              ? { verifierTrustInput: trustInput }
              : {}),
          },
          {
            tester,
            reviewer,
            verifier,
          },
          policy,
        );

        helpers.recordAgentExecution({
          sessionId,
          agentId: "expert",
          success: result.steps.some((step) => step.status === "executed"),
          durationMs: Math.max(0, Date.now() - qualityStartedAt),
          retries: result.qualitySummary.resilience.retries,
          tokensIn: estimateTokens({ query, policy }),
          tokensOut: estimateTokens(result),
          progress: 100,
        });

        const qualityStages = result.steps.length;
        for (const [index, step] of result.steps.entries()) {
          helpers.recordAgentExecution({
            sessionId,
            agentId: step.handoff.to,
            success: step.status === "executed",
            durationMs: step.durationMs ?? 0,
            retries: Math.max(0, (step.attempts ?? 1) - 1),
            tokensIn: estimateTokens(step.handoff),
            tokensOut: estimateTokens(step.result),
            progress:
              qualityStages === 0
                ? 100
                : Math.round(((index + 1) / qualityStages) * 100),
          });
        }

        stdout.write(
          `${JSON.stringify(
            { contractVersion: "1.1.0", policy, result },
            null,
            2,
          )}\n`,
        );
      });

    program
      .command("agents:workflow [query]")
      .description("Plan the 9-phase D3 workflow for a query")
      .option("-s, --session <sessionId>", "Session id")
      .option("-d, --domains <domain...>", "Domains to include in plan context")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("--execute", "Execute planned phases")
      .option("--resume", "Resume from persisted checkpoint")
      .option("--no-cache", "Disable checkpoint cache reuse")
      .option(
        "--reindex",
        "Reindex design-stage phases and replay downstream phases",
        false,
      )
      .option(
        "--continue-on-failure",
        "Continue remaining phases when a phase fails",
        false,
      )
      .option(
        "--workflow <mode>",
        "Workflow mode (static|dynamic|quick)",
        parseWorkflowMode,
      )
      .option("--mode <mode>", "Analysis mode (quick|deep)", parseAnalysisMode)
      .option(
        "--file-count <count>",
        "Complexity hint: number of impacted files",
        parseNonNegativeInteger,
      )
      .option(
        "--pattern-count <count>",
        "Complexity hint: number of detected patterns",
        parseNonNegativeInteger,
      )
      .action(
        async (
          query: string | undefined,
          cmdOptions: AgentsWorkflowOptions,
        ) => {
          const sessionId = cmdOptions.session ?? "default-session";
          const config = loadConfig();
          const engine = container.resolveOr(
            TOKENS.D3WorkflowEngine as Token<D3WorkflowEngine>,
            new D3WorkflowEngine({
              defaultMode: config.workflow.default,
              staticOverride: config.workflow.static_override,
              quickThreshold: config.workflow.quick_threshold,
            }),
          );

          const createExecutor = (): D3WorkflowExecutor => {
            const checkpointStore = container.resolveOr(
              TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
              new FileD3WorkflowCheckpointStore(),
            );

            return new D3WorkflowExecutor(
              container.resolve(
                TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
              ),
              {
                scout: container.resolve(
                  TOKENS.ScoutSubagent as Token<ScoutSubagent>,
                ),
                builder: container.resolve(
                  TOKENS.BuilderSubagent as Token<BuilderSubagent>,
                ),
                tester: container.resolve(
                  TOKENS.TesterSubagent as Token<TesterSubagent>,
                ),
                reviewer: container.resolve(
                  TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
                ),
                verifier: container.resolve(
                  TOKENS.VerifierSubagent as Token<VerifierSubagent>,
                ),
              },
              Date.now,
              checkpointStore,
            );
          };

          if (cmdOptions.resume) {
            const executor = createExecutor();
            const execution = await executor.execute({
              resumeSessionId: sessionId,
              ...(cmdOptions.cache !== undefined
                ? { useCache: cmdOptions.cache }
                : {}),
              ...(cmdOptions.reindex !== undefined
                ? { reindex: cmdOptions.reindex }
                : {}),
              ...(cmdOptions.continueOnFailure !== undefined
                ? { continueOnFailure: cmdOptions.continueOnFailure }
                : {}),
            });

            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: execution.status === "completed",
              durationMs: 0,
              tokensIn: estimateTokens({ sessionId, resume: true }),
              tokensOut: estimateTokens(execution),
              progress: 100,
            });

            stdout.write(
              `${JSON.stringify(
                {
                  contractVersion: "1.1.0",
                  execution,
                  resume: execution.resume,
                },
                null,
                2,
              )}\n`,
            );
            return;
          }

          if (query === undefined) {
            throw new Error(
              "Expected query argument unless --resume is provided",
            );
          }

          const plan = engine.plan({
            sessionId,
            query,
            ...(cmdOptions.files !== undefined
              ? { filePaths: cmdOptions.files }
              : {}),
            ...(cmdOptions.domains !== undefined
              ? { domains: cmdOptions.domains }
              : {}),
            ...(cmdOptions.workflow !== undefined
              ? { workflowMode: cmdOptions.workflow }
              : {}),
            ...(cmdOptions.mode !== undefined
              ? { analysisMode: cmdOptions.mode }
              : {}),
            ...(cmdOptions.fileCount !== undefined ||
            cmdOptions.patternCount !== undefined
              ? {
                  complexity: {
                    ...(cmdOptions.fileCount !== undefined
                      ? { fileCount: cmdOptions.fileCount }
                      : {}),
                    ...(cmdOptions.patternCount !== undefined
                      ? { patternCount: cmdOptions.patternCount }
                      : {}),
                  },
                }
              : {}),
          });

          if (cmdOptions.execute) {
            const executor = createExecutor();
            const execution = await executor.execute({
              plan,
              ...(cmdOptions.files !== undefined
                ? { filePaths: cmdOptions.files }
                : {}),
              ...(cmdOptions.domains !== undefined
                ? { domains: cmdOptions.domains }
                : {}),
              ...(cmdOptions.cache !== undefined
                ? { useCache: cmdOptions.cache }
                : {}),
              ...(cmdOptions.reindex !== undefined
                ? { reindex: cmdOptions.reindex }
                : {}),
              ...(cmdOptions.continueOnFailure !== undefined
                ? { continueOnFailure: cmdOptions.continueOnFailure }
                : {}),
            });

            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: execution.status === "completed",
              durationMs: 0,
              tokensIn: estimateTokens(query),
              tokensOut: estimateTokens({ plan, execution }),
              progress: 100,
            });

            stdout.write(
              `${JSON.stringify(
                {
                  contractVersion: "1.1.0",
                  plan,
                  execution,
                  resume: execution.resume,
                },
                null,
                2,
              )}\n`,
            );
            return;
          }

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: 0,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(plan),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ contractVersion: "1.0.0", plan }, null, 2)}\n`,
          );
        },
      );

    program
      .command("agents:verifier <query>")
      .description("Run verifier scaffold gate assessment for a query")
      .option("-d, --domains <domain...>", "Domains to include in handoff")
      .option("-f, --files <path...>", "Relevant file path hints")
      .option("-s, --session <sessionId>", "Session id")
      .option(
        "--test-pass-rate <value>",
        "Trust input: test pass rate (0..1)",
        parseProbability,
      )
      .option(
        "--review-severity <severity>",
        "Trust input: review severity (low|medium|high|critical)",
      )
      .option(
        "--completeness <value>",
        "Trust input: evidence completeness (0..1)",
        parseProbability,
      )
      .option(
        "--evidence-quality <value>",
        "Trust input: evidence quality (0..1)",
        parseProbability,
      )
      .option(
        "--coverage <value>",
        "Trust input: coverage (0..1)",
        parseProbability,
      )
      .option(
        "--reproducibility <value>",
        "Trust input: reproducibility (0..1)",
        parseProbability,
      )
      .action(async (query: string, cmdOptions: AgentsVerifierOptions) => {
        const sessionId = cmdOptions.session ?? "default-session";
        const expert = container.resolve(
          TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
        );
        const verifier = container.resolve(
          TOKENS.VerifierSubagent as Token<VerifierSubagent>,
        );

        const expertStartedAt = Date.now();
        const handoff = expert.createVerifierHandoff({
          sessionId,
          query,
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const trustInput = buildVerifierTrustInput(cmdOptions);

        const verifierStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const assessment = await verifier.assess({
            handoff: validatedHandoff,
            ...(Object.keys(trustInput).length > 0 ? { trustInput } : {}),
          });
          success = true;

          helpers.recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          helpers.recordAgentExecution({
            sessionId,
            agentId: "verifier",
            success: assessment.gateDecision === "pass",
            durationMs: Math.max(0, Date.now() - verifierStartedAt),
            tokensIn: estimateTokens({ validatedHandoff, trustInput }),
            tokensOut: estimateTokens(assessment),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify(
              { handoff: validatedHandoff, assessment },
              null,
              2,
            )}\n`,
          );
        } finally {
          if (!success) {
            helpers.recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            helpers.recordAgentExecution({
              sessionId,
              agentId: "verifier",
              success: false,
              durationMs: Math.max(0, Date.now() - verifierStartedAt),
              tokensIn: estimateTokens({ handoff, trustInput }),
              progress: 0,
            });
          }
        }
      });
  };

  return { register };
};
