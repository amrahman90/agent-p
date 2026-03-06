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
} from "./agents/index.js";
import type { ExpertQualityExecutionPolicy } from "./agents/index.js";
import { loadConfig } from "./config/load-config.js";
import { bootstrapContainer } from "./core/bootstrap.js";
import { TOKENS, type Container, type Token } from "./core/container.js";
import { DatabaseManager } from "./db/database-manager.js";
import {
  EvaluationEngine,
  ProgressReportPipeline,
  type EvaluationInput,
  SelfLearningPatternStore,
  SkillEffectivenessStore,
} from "./evals/index.js";
import { MemoryManager } from "./memory/index.js";
import { SearchEngine } from "./search/index.js";
import {
  load_skill,
  type SkillActivator,
  type SkillRegistry,
} from "./skills/index.js";
import {
  NotificationHook,
  PostToolUseHook,
  PreToolUseHook,
  SessionStartHook,
  StopHook,
  hookPlatformSchema,
  getDefaultHookAuditSink,
  toClaudeNotificationOutput,
  toClaudePostToolUseOutput,
  toClaudePreToolUseOutput,
  toClaudeSessionStartOutput,
  toClaudeStopOutput,
  toOpenCodeNotificationOutput,
  toOpenCodePostToolUseOutput,
  toOpenCodePreToolUseOutput,
  toOpenCodeSessionStartOutput,
  toOpenCodeStopOutput,
} from "./hooks/index.js";
import {
  CostTrackingMiddleware,
  SessionMetricsTracker,
  type TelemetrySearchRunEvent,
} from "./telemetry/index.js";
import {
  D3WorkflowEngine,
  D3WorkflowExecutor,
  FileD3WorkflowCheckpointStore,
  type D3AnalysisMode,
  type D3WorkflowCheckpointStore,
  type D3WorkflowMode,
} from "./workflow/index.js";

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received '${value}'`);
  }

  return parsed;
};

const parseNonNegativeInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received '${value}'`);
  }

  return parsed;
};

const parseProbability = (value: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a number between 0 and 1, received '${value}'`);
  }

  return parsed;
};

const parseScale1to5 = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    throw new Error(`Expected an integer between 1 and 5, received '${value}'`);
  }

  return parsed;
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Expected valid JSON object, received '${value}'`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected valid JSON object, received '${value}'`);
  }

  return parsed as Record<string, unknown>;
};

const parseJsonUnknown = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Expected valid JSON, received '${value}'`);
  }
};

const parseHookPlatform = (value: string): "neutral" | "claude" | "opencode" =>
  hookPlatformSchema.parse(value);

const parseWorkflowMode = (value: string): D3WorkflowMode => {
  if (value === "static" || value === "dynamic" || value === "quick") {
    return value;
  }

  throw new Error(
    `Expected workflow mode static|dynamic|quick, received '${value}'`,
  );
};

const parseAnalysisMode = (value: string): D3AnalysisMode => {
  if (value === "quick" || value === "deep") {
    return value;
  }

  throw new Error(`Expected analysis mode quick|deep, received '${value}'`);
};

const asRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
};

const estimateTokens = (value: unknown): number => {
  if (value === undefined) {
    return 0;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return 0;
    }

    return Math.max(0, Math.ceil(serialized.length / 4));
  } catch {
    return 0;
  }
};

const clampProgress = (value: number): number =>
  Math.max(0, Math.min(100, Math.trunc(value)));

const buildVerifierTrustInput = (options: {
  testPassRate?: number;
  reviewSeverity?: "low" | "medium" | "high" | "critical";
  completeness?: number;
  evidenceQuality?: number;
  coverage?: number;
  reproducibility?: number;
}): Partial<{
  testPassRate: number;
  reviewSeverity: "low" | "medium" | "high" | "critical";
  completeness: number;
  evidenceQuality: number;
  coverage: number;
  reproducibility: number;
}> => ({
  ...(options.testPassRate !== undefined
    ? { testPassRate: options.testPassRate }
    : {}),
  ...(options.reviewSeverity !== undefined
    ? { reviewSeverity: options.reviewSeverity }
    : {}),
  ...(options.completeness !== undefined
    ? { completeness: options.completeness }
    : {}),
  ...(options.evidenceQuality !== undefined
    ? { evidenceQuality: options.evidenceQuality }
    : {}),
  ...(options.coverage !== undefined ? { coverage: options.coverage } : {}),
  ...(options.reproducibility !== undefined
    ? { reproducibility: options.reproducibility }
    : {}),
});

export interface CliDependencies {
  readonly container?: Container;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
}

export const createCliProgram = (
  dependencies: CliDependencies = {},
): Command => {
  const container = dependencies.container ?? bootstrapContainer();
  const stdout = dependencies.stdout ?? process.stdout;
  const resolveOptional = <T>(token: Token<T>): T | undefined => {
    try {
      return container.resolve(token);
    } catch {
      return undefined;
    }
  };
  const telemetryTracker = resolveOptional(
    TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
  );
  const tokenCostTracker = resolveOptional(
    TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
  );
  const skillEffectiveness = resolveOptional(
    TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
  );
  const progressReports = resolveOptional(
    TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
  );
  const program = new Command();

  program
    .name("agent-p")
    .description("Agentic workflow tool for software engineering tasks")
    .version("0.0.1");

  const recordSkillActivation = (input: {
    sessionId: string;
    skillName: string;
    success: boolean;
    latencyMs: number;
    tokens?: number;
  }): void => {
    if (!skillEffectiveness) {
      return;
    }

    skillEffectiveness.recordActivation({
      sessionId: input.sessionId,
      skillName: input.skillName,
      success: input.success,
      latencyMs: input.latencyMs,
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    });
  };

  const recordAgentExecution = (input: {
    sessionId: string;
    agentId: string;
    success: boolean;
    durationMs: number;
    retries?: number;
    tokensIn?: number;
    tokensOut?: number;
    progress?: number;
  }): void => {
    telemetryTracker?.recordAgentRun({
      sessionId: input.sessionId,
      agentId: input.agentId,
      success: input.success,
      durationMs: input.durationMs,
      ...(input.retries !== undefined ? { retries: input.retries } : {}),
      ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
      ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
    });

    progressReports?.record({
      sessionId: input.sessionId,
      agent: input.agentId,
      status: input.success ? "completed" : "failed",
      progress: clampProgress(input.progress ?? (input.success ? 100 : 0)),
      tokens: (input.tokensIn ?? 0) + (input.tokensOut ?? 0),
      latencyMs: input.durationMs,
      retries: input.retries ?? 0,
    });
  };

  program
    .command("config:check")
    .description("Validate and print effective config")
    .option("-c, --config <path>", "Custom config path")
    .action((options: { config?: string }) => {
      const config = loadConfig(options.config);
      stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    });

  program
    .command("db:check")
    .description("Initialize database and print selected sqlite driver")
    .action(async () => {
      const manager = new DatabaseManager();
      const info = await manager.initialize();
      stdout.write(`${JSON.stringify(info)}\n`);
      manager.close();
    });

  program
    .command("stats")
    .description("Show aggregated session telemetry metrics")
    .option("-s, --session <sessionId>", "Session id", "default-session")
    .action((options: { session: string }) => {
      const tracker = container.resolveOr(
        TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
        new SessionMetricsTracker(),
      );
      const summary = tracker.summarizeSession(options.session);
      stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    });

  program
    .command("eval")
    .description("Run evaluation scoring from session telemetry")
    .option("-s, --session <sessionId>", "Session id", "default-session")
    .option(
      "--trust-score <value>",
      "Override trust score input (0..1)",
      parseProbability,
    )
    .option(
      "--activation-accuracy <value>",
      "Override skill activation accuracy input (0..1)",
      parseProbability,
    )
    .option(
      "--retry-rate <value>",
      "Override retry rate input (0..1)",
      parseProbability,
    )
    .action(
      (options: {
        session: string;
        trustScore?: number;
        activationAccuracy?: number;
        retryRate?: number;
      }) => {
        const tracker = container.resolveOr(
          TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
          new SessionMetricsTracker(),
        );
        const engine = container.resolveOr(
          TOKENS.EvaluationEngine as Token<EvaluationEngine>,
          new EvaluationEngine(),
        );

        const summary = tracker.summarizeSession(options.session);
        const inferredTrust =
          summary.postToolUse.total > 0
            ? asRate(summary.postToolUse.allowed, summary.postToolUse.total)
            : 0;
        const inferredSuccessRate =
          summary.agents.totalRuns > 0
            ? asRate(summary.agents.successRuns, summary.agents.totalRuns)
            : inferredTrust;

        const input: EvaluationInput = {
          trustScore: options.trustScore ?? inferredTrust,
          successRate: inferredSuccessRate,
          activationAccuracy: options.activationAccuracy ?? 1,
          averageLatencyMs: summary.postToolUse.averageLatencyMs,
          retryRate: options.retryRate ?? 0,
        };

        const evaluation = engine.evaluate(input);
        stdout.write(
          `${JSON.stringify(
            {
              sessionId: options.session,
              input,
              evaluation,
            },
            null,
            2,
          )}\n`,
        );
      },
    );

  const debug = program
    .command("debug")
    .description("Debug observability subsystems");

  debug
    .command("agents")
    .description("Show per-agent execution metrics for a session")
    .option("-s, --session <sessionId>", "Session id", "default-session")
    .action((options: { session: string }) => {
      const tracker = telemetryTracker ?? new SessionMetricsTracker();
      const reports = progressReports?.latestByAgent(options.session) ?? [];
      const events = tracker
        .listSessionEvents(options.session)
        .filter((event) => event.kind === "agent_run");

      const perAgent = new Map<
        string,
        {
          runs: number;
          successes: number;
          failures: number;
          totalDurationMs: number;
          retries: number;
          tokensIn: number;
          tokensOut: number;
          costUsd: number;
        }
      >();

      for (const event of events) {
        const current = perAgent.get(event.agentId) ?? {
          runs: 0,
          successes: 0,
          failures: 0,
          totalDurationMs: 0,
          retries: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        };

        current.runs += 1;
        current.successes += event.success ? 1 : 0;
        current.failures += event.success ? 0 : 1;
        current.totalDurationMs += event.durationMs;
        current.retries += event.retries;
        current.tokensIn += event.tokensIn;
        current.tokensOut += event.tokensOut;
        current.costUsd += event.costUsd;
        perAgent.set(event.agentId, current);
      }

      const agents = Array.from(perAgent.entries())
        .map(([agentId, summary]) => ({
          agentId,
          runs: summary.runs,
          successRate:
            summary.runs === 0 ? 0 : summary.successes / summary.runs,
          failures: summary.failures,
          averageDurationMs:
            summary.runs === 0 ? 0 : summary.totalDurationMs / summary.runs,
          retries: summary.retries,
          tokensIn: summary.tokensIn,
          tokensOut: summary.tokensOut,
          costUsd: summary.costUsd,
        }))
        .sort((left, right) => left.agentId.localeCompare(right.agentId));

      stdout.write(
        `${JSON.stringify(
          {
            sessionId: options.session,
            agents,
            latestProgressReports: reports,
          },
          null,
          2,
        )}\n`,
      );
    });

  debug
    .command("skills")
    .description("Show tracked skill effectiveness")
    .action(() => {
      const store = skillEffectiveness ?? new SkillEffectivenessStore();
      const skills = store.summarizeAllSkills();
      stdout.write(
        `${JSON.stringify(
          {
            skills,
            totals: {
              activations: skills.reduce(
                (sum, skill) => sum + skill.activations,
                0,
              ),
              successes: skills.reduce(
                (sum, skill) => sum + skill.successes,
                0,
              ),
              failures: skills.reduce((sum, skill) => sum + skill.failures, 0),
            },
          },
          null,
          2,
        )}\n`,
      );
    });

  debug
    .command("memory")
    .description("Show current memory manager state")
    .action(() => {
      const memory = resolveOptional(
        TOKENS.MemoryManager as Token<MemoryManager>,
      );
      const entries = memory?.listAll() ?? [];
      const byScope = entries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.scope] = (acc[entry.scope] ?? 0) + 1;
        return acc;
      }, {});

      stdout.write(
        `${JSON.stringify(
          {
            entries: entries.length,
            byScope: {
              private: byScope.private ?? 0,
              session: byScope.session ?? 0,
              shared: byScope.shared ?? 0,
              user: byScope.user ?? 0,
            },
          },
          null,
          2,
        )}\n`,
      );
    });

  debug
    .command("search")
    .description("Show search pipeline telemetry for a session")
    .option("-s, --session <sessionId>", "Session id", "default-session")
    .action((options: { session: string }) => {
      const tracker = telemetryTracker ?? new SessionMetricsTracker();
      const events = tracker
        .listSessionEvents(options.session)
        .filter(
          (event): event is TelemetrySearchRunEvent =>
            event.kind === "search_run",
        );

      const searchEngine = resolveOptional(
        TOKENS.SearchEngine as Token<SearchEngine>,
      );

      const orderedEvents = [...events].sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }

        const queryOrder = left.query.localeCompare(right.query);
        if (queryOrder !== 0) {
          return queryOrder;
        }

        const providerOrder = left.provider.localeCompare(right.provider);
        if (providerOrder !== 0) {
          return providerOrder;
        }

        return (left.error ?? "").localeCompare(right.error ?? "");
      });

      const errors = orderedEvents.filter((event) => event.error !== undefined);

      stdout.write(
        `${JSON.stringify(
          {
            sessionId: options.session,
            searchRuns: {
              total: orderedEvents.length,
              successes: orderedEvents.length - errors.length,
              failures: errors.length,
              averageDurationMs:
                orderedEvents.length === 0
                  ? 0
                  : orderedEvents.reduce(
                      (sum, event) => sum + event.durationMs,
                      0,
                    ) / orderedEvents.length,
              averageResultCount:
                orderedEvents.length === 0
                  ? 0
                  : orderedEvents.reduce(
                      (sum, event) => sum + event.resultCount,
                      0,
                    ) / orderedEvents.length,
            },
            providers: Array.from(
              orderedEvents.reduce((acc, event) => {
                acc.set(event.provider, (acc.get(event.provider) ?? 0) + 1);
                return acc;
              }, new Map<string, number>()),
            )
              .map(([provider, runs]) => ({ provider, runs }))
              .sort((left, right) =>
                left.provider.localeCompare(right.provider),
              ),
            recentErrors: errors.slice(-5).map((event) => ({
              timestamp: event.timestamp,
              query: event.query,
              provider: event.provider,
              error: event.error,
            })),
            events: orderedEvents.map((event) => ({
              timestamp: event.timestamp,
              query: event.query,
              provider: event.provider,
              durationMs: event.durationMs,
              result_count: event.resultCount,
              ...(event.error !== undefined ? { errors: event.error } : {}),
            })),
            pipeline: {
              available: searchEngine !== undefined,
              stages: ["sanitize", "ripgrep", "bm25"],
            },
          },
          null,
          2,
        )}\n`,
      );
    });

  debug
    .command("tokens")
    .description("Show token and cost telemetry for a session")
    .option("-s, --session <sessionId>", "Session id", "default-session")
    .action((options: { session: string }) => {
      const cost = tokenCostTracker ?? new CostTrackingMiddleware();
      const summary = cost.summarizeSession(options.session);
      stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    });

  debug
    .command("hooks")
    .description("Show hook audit history")
    .option("-l, --limit <count>", "Max events to print", parsePositiveInteger)
    .action((options: { limit?: number }) => {
      const sink = getDefaultHookAuditSink();
      const events = sink.snapshot();
      const limitedEvents =
        options.limit !== undefined ? events.slice(-options.limit) : events;

      stdout.write(`${JSON.stringify(limitedEvents, null, 2)}\n`);
    });

  debug
    .command("prune")
    .description("Prune observability JSONL streams")
    .option(
      "--tokens-max-age-days <days>",
      "Retention for .agent-p/telemetry/tokens",
      parseNonNegativeInteger,
      30,
    )
    .option(
      "--progress-max-age-days <days>",
      "Retention for .agent-p/telemetry/progress",
      parseNonNegativeInteger,
      30,
    )
    .option(
      "--skills-max-age-days <days>",
      "Retention for .agent-p/evals/skills",
      parseNonNegativeInteger,
      30,
    )
    .action(
      (options: {
        tokensMaxAgeDays: number;
        progressMaxAgeDays: number;
        skillsMaxAgeDays: number;
      }) => {
        const tokens = (tokenCostTracker ?? new CostTrackingMiddleware()).prune(
          {
            maxAgeDays: options.tokensMaxAgeDays,
          },
        );
        const progress = (
          progressReports ?? new ProgressReportPipeline()
        ).prune({ maxAgeDays: options.progressMaxAgeDays });
        const skills = (
          skillEffectiveness ?? new SkillEffectivenessStore()
        ).prune({ maxAgeDays: options.skillsMaxAgeDays });

        stdout.write(
          `${JSON.stringify(
            {
              streams: {
                tokens,
                progress,
                skills,
              },
            },
            null,
            2,
          )}\n`,
        );
      },
    );

  program
    .command("hooks:config")
    .description("Print effective hooks policy and audit config")
    .option("-c, --config <path>", "Custom config path")
    .action((options: { config?: string }) => {
      const config = loadConfig(options.config);
      stdout.write(`${JSON.stringify(config.hooks, null, 2)}\n`);
    });

  program
    .command("hooks:audit-log")
    .description("Print in-memory hook audit events")
    .option("-l, --limit <count>", "Max events to print", parsePositiveInteger)
    .option("--clear", "Clear in-memory audit log after printing")
    .action((options: { limit?: number; clear?: boolean }) => {
      const sink = getDefaultHookAuditSink();
      const events = sink.snapshot();
      const limitedEvents =
        options.limit !== undefined ? events.slice(-options.limit) : events;
      stdout.write(`${JSON.stringify(limitedEvents, null, 2)}\n`);

      if (options.clear) {
        sink.clear();
      }
    });

  program
    .command("hooks:session-start <sessionId>")
    .description("Execute SessionStart hook scaffold")
    .option("-q, --query <query>", "User query associated with this session")
    .option("-c, --config <path>", "Custom config path")
    .option(
      "--platform <target>",
      "Output target platform (neutral|claude|opencode)",
      parseHookPlatform,
      "neutral",
    )
    .action(
      (
        sessionId: string,
        options: {
          query?: string;
          config?: string;
          platform: "neutral" | "claude" | "opencode";
        },
      ) => {
        const config = loadConfig(options.config);
        const hook = container.resolveOr(
          TOKENS.SessionStartHook as Token<SessionStartHook>,
          new SessionStartHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            ...(options.query !== undefined ? { query: options.query } : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.sessionStart,
          },
          {
            audit: config.hooks.audit,
            platform: options.platform,
          },
        );

        const output =
          options.platform === "claude"
            ? toClaudeSessionStartOutput(result)
            : options.platform === "opencode"
              ? toOpenCodeSessionStartOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      },
    );

  program
    .command("hooks:pre-tool-use <sessionId> <toolName>")
    .description("Execute PreToolUse hook with neutral/runtime policy")
    .option(
      "--tool-input <json>",
      "Tool input as JSON object",
      parseJsonObject,
      {},
    )
    .option("--tool-use-id <id>", "Tool use id")
    .option("--blocked-pattern <pattern...>", "Blocking patterns to enforce")
    .option("--dry-run", "Enable dry-run mode (log-only policy)")
    .option("-c, --config <path>", "Custom config path")
    .option(
      "--platform <target>",
      "Output target platform (neutral|claude|opencode)",
      parseHookPlatform,
      "neutral",
    )
    .action(
      (
        sessionId: string,
        toolName: string,
        options: {
          toolInput: Record<string, unknown>;
          toolUseId?: string;
          blockedPattern?: string[];
          dryRun?: boolean;
          config?: string;
          platform: "neutral" | "claude" | "opencode";
        },
      ) => {
        const config = loadConfig(options.config);
        const hook = container.resolveOr(
          TOKENS.PreToolUseHook as Token<PreToolUseHook>,
          new PreToolUseHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            toolName,
            toolInput: options.toolInput,
            ...(options.toolUseId !== undefined
              ? { toolUseId: options.toolUseId }
              : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.preToolUse,
            mode: options.dryRun ? "dry-run" : "enforce",
            blockedPatterns: options.blockedPattern ?? [],
          },
          {
            policy: config.hooks.policy,
            audit: config.hooks.audit,
            platform: options.platform,
          },
        );

        const output =
          options.platform === "claude"
            ? toClaudePreToolUseOutput(result)
            : options.platform === "opencode"
              ? toOpenCodePreToolUseOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      },
    );

  program
    .command("hooks:post-tool-use <sessionId> <toolName>")
    .description("Execute PostToolUse hook with neutral/runtime policy")
    .option(
      "--tool-input <json>",
      "Tool input as JSON object",
      parseJsonObject,
      {},
    )
    .option("--tool-response <json>", "Tool response as JSON", parseJsonUnknown)
    .option("--tool-use-id <id>", "Tool use id")
    .option("--block-pattern <pattern...>", "Post-tool blocking patterns")
    .option("-c, --config <path>", "Custom config path")
    .option(
      "--platform <target>",
      "Output target platform (neutral|claude|opencode)",
      parseHookPlatform,
      "neutral",
    )
    .action(
      (
        sessionId: string,
        toolName: string,
        options: {
          toolInput: Record<string, unknown>;
          toolResponse?: unknown;
          toolUseId?: string;
          blockPattern?: string[];
          config?: string;
          platform: "neutral" | "claude" | "opencode";
        },
      ) => {
        const config = loadConfig(options.config);
        const hook = container.resolveOr(
          TOKENS.PostToolUseHook as Token<PostToolUseHook>,
          new PostToolUseHook(),
        );
        const telemetryRecorder = container.resolveOr(
          TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
          new SessionMetricsTracker(),
        );
        const selfLearningRecorder = container.resolveOr(
          TOKENS.SelfLearningPatternStore as Token<SelfLearningPatternStore>,
          new SelfLearningPatternStore(),
        );
        const result = hook.execute(
          {
            sessionId,
            toolName,
            toolInput: options.toolInput,
            ...(options.toolResponse !== undefined
              ? { toolResponse: options.toolResponse }
              : {}),
            ...(options.toolUseId !== undefined
              ? { toolUseId: options.toolUseId }
              : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.postToolUse,
            blockPatterns: options.blockPattern ?? [],
          },
          {
            policy: config.hooks.policy,
            audit: config.hooks.audit,
            platform: options.platform,
            telemetryRecorder,
            selfLearningRecorder,
          },
        );

        const output =
          options.platform === "claude"
            ? toClaudePostToolUseOutput(result)
            : options.platform === "opencode"
              ? toOpenCodePostToolUseOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      },
    );

  program
    .command("hooks:stop <sessionId>")
    .description("Execute Stop hook with neutral/runtime policy")
    .option(
      "--stop-hook-active",
      "Signal stop hook recursion is already active",
    )
    .option("--last-assistant-message <message>", "Last assistant response")
    .option(
      "--completion-signal <signal>",
      "Require signal substring in last assistant message",
    )
    .option("-c, --config <path>", "Custom config path")
    .option(
      "--platform <target>",
      "Output target platform (neutral|claude|opencode)",
      parseHookPlatform,
      "neutral",
    )
    .action(
      (
        sessionId: string,
        options: {
          stopHookActive?: boolean;
          lastAssistantMessage?: string;
          completionSignal?: string;
          config?: string;
          platform: "neutral" | "claude" | "opencode";
        },
      ) => {
        const config = loadConfig(options.config);
        const hook = container.resolveOr(
          TOKENS.StopHook as Token<StopHook>,
          new StopHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            stopHookActive: options.stopHookActive ?? false,
            ...(options.lastAssistantMessage !== undefined
              ? { lastAssistantMessage: options.lastAssistantMessage }
              : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.stop,
            ...(options.completionSignal !== undefined
              ? { completionSignal: options.completionSignal }
              : {}),
          },
          {
            policy: config.hooks.policy,
            audit: config.hooks.audit,
            platform: options.platform,
          },
        );

        const output =
          options.platform === "claude"
            ? toClaudeStopOutput(result)
            : options.platform === "opencode"
              ? toOpenCodeStopOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      },
    );

  program
    .command("hooks:notification <sessionId> <notificationType> <message>")
    .description("Execute Notification hook with neutral/runtime policy")
    .option("--title <title>", "Notification title")
    .option("-c, --config <path>", "Custom config path")
    .option(
      "--platform <target>",
      "Output target platform (neutral|claude|opencode)",
      parseHookPlatform,
      "neutral",
    )
    .action(
      (
        sessionId: string,
        notificationType: string,
        message: string,
        options: {
          title?: string;
          config?: string;
          platform: "neutral" | "claude" | "opencode";
        },
      ) => {
        const config = loadConfig(options.config);
        const hook = container.resolveOr(
          TOKENS.NotificationHook as Token<NotificationHook>,
          new NotificationHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            notificationType,
            message,
            ...(options.title !== undefined ? { title: options.title } : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.notification,
          },
          {
            policy: config.hooks.policy,
            audit: config.hooks.audit,
            platform: options.platform,
          },
        );

        const output =
          options.platform === "claude"
            ? toClaudeNotificationOutput(result)
            : options.platform === "opencode"
              ? toOpenCodeNotificationOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      },
    );

  program
    .command("skills:suggest <query>")
    .description("Suggest skills for a query using trigger matching")
    .option("-a, --agent <agentId>", "Agent id for permission-aware filtering")
    .option("-d, --domains <domain...>", "Domains to bias skill ranking")
    .option("-f, --files <path...>", "File paths to match trigger patterns")
    .option("-m, --include-manual", "Include manual-only skills")
    .option(
      "-l, --limit <count>",
      "Maximum number of suggestions",
      parsePositiveInteger,
    )
    .action(
      (
        query: string,
        options: {
          agent?: string;
          domains?: string[];
          files?: string[];
          includeManual?: boolean;
          limit?: number;
        },
      ) => {
        const startedAt = Date.now();
        const sessionId = "skills-suggest";
        const activator = container.resolve(
          TOKENS.SkillActivator as Token<SkillActivator>,
        );

        const suggestions = activator.suggest({
          query,
          ...(options.agent !== undefined ? { agentId: options.agent } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.includeManual !== undefined
            ? { includeManual: options.includeManual }
            : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        });

        for (const suggestion of suggestions) {
          recordSkillActivation({
            sessionId,
            skillName: suggestion.skill.id,
            success: true,
            latencyMs: Math.max(0, Date.now() - startedAt),
            tokens: estimateTokens({ query, options, suggestion }),
          });
        }

        stdout.write(`${JSON.stringify(suggestions, null, 2)}\n`);
      },
    );

  program
    .command("skills:load <skillId>")
    .description("Manually load a skill by id")
    .option("-a, --agent <agentId>", "Agent id for permission-aware loading")
    .action((skillId: string, options: { agent?: string }) => {
      const startedAt = Date.now();
      const sessionId = "skills-load";
      const registry = container.resolve(
        TOKENS.SkillRegistry as Token<SkillRegistry>,
      );
      let skill;
      try {
        skill = load_skill(registry, {
          skillId,
          ...(options.agent !== undefined ? { agentId: options.agent } : {}),
        });
      } catch (error: unknown) {
        recordSkillActivation({
          sessionId,
          skillName: skillId,
          success: false,
          latencyMs: Math.max(0, Date.now() - startedAt),
          tokens: estimateTokens({ skillId, error: String(error) }),
        });
        throw error;
      }

      recordSkillActivation({
        sessionId,
        skillName: skill.id,
        success: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        tokens: estimateTokens(skill),
      });
      stdout.write(`${JSON.stringify(skill, null, 2)}\n`);
    });

  program
    .command("agents:scout <query>")
    .description("Run scout context discovery for a query")
    .option("-d, --domains <domain...>", "Domains to include in handoff")
    .option("-f, --files <path...>", "Relevant file path hints")
    .option("-s, --session <sessionId>", "Session id")
    .action(
      async (
        query: string,
        options: { domains?: string[]; files?: string[]; session?: string },
      ) => {
        const sessionId = options.session ?? "default-session";
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const scoutStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const analysis = await scout.analyze({ handoff: validatedHandoff });
          success = true;

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          recordAgentExecution({
            sessionId,
            agentId: "scout",
            success: true,
            durationMs: Math.max(0, Date.now() - scoutStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(analysis),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ handoff: validatedHandoff, analysis }, null, 2)}\n`,
          );
        } finally {
          if (!success) {
            recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            recordAgentExecution({
              sessionId,
              agentId: "scout",
              success: false,
              durationMs: Math.max(0, Date.now() - scoutStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      },
    );

  program
    .command("agents:builder <query>")
    .description("Run builder planning scaffold for a query")
    .option("-d, --domains <domain...>", "Domains to include in handoff")
    .option("-f, --files <path...>", "Relevant file path hints")
    .option("-s, --session <sessionId>", "Session id")
    .action(
      async (
        query: string,
        options: { domains?: string[]; files?: string[]; session?: string },
      ) => {
        const sessionId = options.session ?? "default-session";
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const builderStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const plan = await builder.plan({ handoff: validatedHandoff });
          success = true;

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          recordAgentExecution({
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
            recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            recordAgentExecution({
              sessionId,
              agentId: "builder",
              success: false,
              durationMs: Math.max(0, Date.now() - builderStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      },
    );

  program
    .command("agents:tester <query>")
    .description("Run tester planning scaffold for a query")
    .option("-d, --domains <domain...>", "Domains to include in handoff")
    .option("-f, --files <path...>", "Relevant file path hints")
    .option("-s, --session <sessionId>", "Session id")
    .action(
      async (
        query: string,
        options: { domains?: string[]; files?: string[]; session?: string },
      ) => {
        const sessionId = options.session ?? "default-session";
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const testerStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const plan = await tester.plan({ handoff: validatedHandoff });
          success = true;

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          recordAgentExecution({
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
            recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            recordAgentExecution({
              sessionId,
              agentId: "tester",
              success: false,
              durationMs: Math.max(0, Date.now() - testerStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      },
    );

  program
    .command("agents:reviewer <query>")
    .description("Run reviewer scaffold assessment for a query")
    .option("-d, --domains <domain...>", "Domains to include in handoff")
    .option("-f, --files <path...>", "Relevant file path hints")
    .option("-s, --session <sessionId>", "Session id")
    .action(
      async (
        query: string,
        options: { domains?: string[]; files?: string[]; session?: string },
      ) => {
        const sessionId = options.session ?? "default-session";
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
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

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          recordAgentExecution({
            sessionId,
            agentId: "reviewer",
            success: true,
            durationMs: Math.max(0, Date.now() - reviewerStartedAt),
            tokensIn: estimateTokens(validatedHandoff),
            tokensOut: estimateTokens(assessment),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ handoff: validatedHandoff, assessment }, null, 2)}\n`,
          );
        } finally {
          if (!success) {
            recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            recordAgentExecution({
              sessionId,
              agentId: "reviewer",
              success: false,
              durationMs: Math.max(0, Date.now() - reviewerStartedAt),
              tokensIn: estimateTokens(handoff),
              progress: 0,
            });
          }
        }
      },
    );

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
    .action(
      async (
        query: string,
        options: {
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
        },
      ) => {
        const sessionId = options.session ?? "default-session";
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

        const trustInput = buildVerifierTrustInput(options);

        const policy: ExpertQualityExecutionPolicy = {
          ...DEFAULT_EXPERT_QUALITY_EXECUTION_POLICY,
          ...(options.skipTester ? { includeTester: false } : {}),
          ...(options.skipReviewer ? { includeReviewer: false } : {}),
          ...(options.skipVerifier ? { includeVerifier: false } : {}),
          ...(options.importance !== undefined
            ? { importance: options.importance }
            : {}),
          ...(options.stability !== undefined
            ? { stability: options.stability }
            : {}),
          ...(options.minTrustScore !== undefined
            ? { minTrustScore: options.minTrustScore }
            : {}),
          ...(options.minGoalCompletion !== undefined
            ? { minGoalCompletion: options.minGoalCompletion }
            : {}),
          ...(options.continueOnTrustFailure
            ? { continueOnTrustGateFailure: true }
            : {}),
          ...(options.continueOnGoalFailure
            ? { continueOnGoalGateFailure: true }
            : {}),
          ...(options.continueOnStageFailure
            ? { continueOnStageFailure: true }
            : {}),
          ...(options.continueOnStageTimeout
            ? { continueOnStageTimeout: true }
            : {}),
          ...(options.stageTimeoutMs !== undefined
            ? { stageTimeoutMs: options.stageTimeoutMs }
            : {}),
          ...(options.maxStageRetries !== undefined
            ? { maxStageRetries: options.maxStageRetries }
            : {}),
          ...(options.circuitBreakerFailureThreshold !== undefined
            ? {
                circuitBreakerFailureThreshold:
                  options.circuitBreakerFailureThreshold,
              }
            : {}),
          ...(options.rateLimitMaxExecutions !== undefined
            ? { rateLimitMaxExecutions: options.rateLimitMaxExecutions }
            : {}),
          ...(options.rateLimitWindowMs !== undefined
            ? { rateLimitWindowMs: options.rateLimitWindowMs }
            : {}),
          ...(options.continueOnRateLimit ? { continueOnRateLimit: true } : {}),
        };

        const result = await expert.executeQualityPath(
          {
            sessionId,
            query,
            ...(options.files !== undefined
              ? { filePaths: options.files }
              : {}),
            ...(options.domains !== undefined
              ? { domains: options.domains }
              : {}),
            ...(options.parentHandoff !== undefined
              ? { parentHandoffId: options.parentHandoff }
              : {}),
            ...(options.attempt !== undefined
              ? { attempt: options.attempt }
              : {}),
            ...(options.trustScore !== undefined ||
            options.goalCompletion !== undefined
              ? {
                  gateInput: {
                    ...(options.trustScore !== undefined
                      ? { trustScore: options.trustScore }
                      : {}),
                    ...(options.goalCompletion !== undefined
                      ? { goalCompletion: options.goalCompletion }
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

        recordAgentExecution({
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
          recordAgentExecution({
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
          `${JSON.stringify({ contractVersion: "1.1.0", policy, result }, null, 2)}\n`,
        );
      },
    );

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
        options: {
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
        },
      ) => {
        const sessionId = options.session ?? "default-session";
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

        if (options.resume) {
          const executor = createExecutor();
          const execution = await executor.execute({
            resumeSessionId: sessionId,
            ...(options.cache !== undefined ? { useCache: options.cache } : {}),
            ...(options.reindex !== undefined
              ? { reindex: options.reindex }
              : {}),
            ...(options.continueOnFailure !== undefined
              ? { continueOnFailure: options.continueOnFailure }
              : {}),
          });

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: execution.status === "completed",
            durationMs: 0,
            tokensIn: estimateTokens({ sessionId, resume: true }),
            tokensOut: estimateTokens(execution),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ contractVersion: "1.1.0", execution, resume: execution.resume }, null, 2)}\n`,
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
          ...(options.workflow !== undefined
            ? { workflowMode: options.workflow }
            : {}),
          ...(options.mode !== undefined ? { analysisMode: options.mode } : {}),
          ...(options.fileCount !== undefined ||
          options.patternCount !== undefined
            ? {
                complexity: {
                  ...(options.fileCount !== undefined
                    ? { fileCount: options.fileCount }
                    : {}),
                  ...(options.patternCount !== undefined
                    ? { patternCount: options.patternCount }
                    : {}),
                },
              }
            : {}),
        });

        if (options.execute) {
          const executor = createExecutor();
          const execution = await executor.execute({
            plan,
            ...(options.files !== undefined
              ? { filePaths: options.files }
              : {}),
            ...(options.domains !== undefined
              ? { domains: options.domains }
              : {}),
            ...(options.cache !== undefined ? { useCache: options.cache } : {}),
            ...(options.reindex !== undefined
              ? { reindex: options.reindex }
              : {}),
            ...(options.continueOnFailure !== undefined
              ? { continueOnFailure: options.continueOnFailure }
              : {}),
          });

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: execution.status === "completed",
            durationMs: 0,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens({ plan, execution }),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ contractVersion: "1.1.0", plan, execution, resume: execution.resume }, null, 2)}\n`,
          );
          return;
        }

        recordAgentExecution({
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
    .action(
      async (
        query: string,
        options: {
          domains?: string[];
          files?: string[];
          session?: string;
          testPassRate?: number;
          reviewSeverity?: "low" | "medium" | "high" | "critical";
          completeness?: number;
          evidenceQuality?: number;
          coverage?: number;
          reproducibility?: number;
        },
      ) => {
        const sessionId = options.session ?? "default-session";
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
          ...(options.files !== undefined ? { filePaths: options.files } : {}),
          ...(options.domains !== undefined
            ? { domains: options.domains }
            : {}),
        });
        const expertDurationMs = Math.max(0, Date.now() - expertStartedAt);

        const trustInput = buildVerifierTrustInput(options);

        const verifierStartedAt = Date.now();
        let success = false;
        try {
          const validatedHandoff = validateAgentHandoffPayload(handoff);
          const assessment = await verifier.assess({
            handoff: validatedHandoff,
            ...(Object.keys(trustInput).length > 0 ? { trustInput } : {}),
          });
          success = true;

          recordAgentExecution({
            sessionId,
            agentId: "expert",
            success: true,
            durationMs: expertDurationMs,
            tokensIn: estimateTokens(query),
            tokensOut: estimateTokens(validatedHandoff),
            progress: 25,
          });
          recordAgentExecution({
            sessionId,
            agentId: "verifier",
            success: assessment.gateDecision === "pass",
            durationMs: Math.max(0, Date.now() - verifierStartedAt),
            tokensIn: estimateTokens({ validatedHandoff, trustInput }),
            tokensOut: estimateTokens(assessment),
            progress: 100,
          });

          stdout.write(
            `${JSON.stringify({ handoff: validatedHandoff, assessment }, null, 2)}\n`,
          );
        } finally {
          if (!success) {
            recordAgentExecution({
              sessionId,
              agentId: "expert",
              success: false,
              durationMs: expertDurationMs,
              tokensIn: estimateTokens(query),
              progress: 0,
            });
            recordAgentExecution({
              sessionId,
              agentId: "verifier",
              success: false,
              durationMs: Math.max(0, Date.now() - verifierStartedAt),
              tokensIn: estimateTokens({ handoff, trustInput }),
              progress: 0,
            });
          }
        }
      },
    );

  return program;
};

export const runCli = async (
  argv: readonly string[] = process.argv,
): Promise<void> => {
  const program = createCliProgram({
    container: bootstrapContainer(),
    stdout: process.stdout,
  });
  await program.parseAsync(argv as string[]);
};
