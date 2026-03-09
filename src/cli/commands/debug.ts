import { Command } from "commander";

import type { Container, Token } from "../../core/container.js";
import { TOKENS } from "../../core/container.js";
import { MemoryManager, type MemoryEntry } from "../../memory/index.js";
import {
  ProgressReportPipeline,
  SkillEffectivenessStore,
} from "../../evals/index.js";
import { SearchEngine } from "../../search/index.js";
import type { TelemetrySearchRunEvent } from "../../telemetry/index.js";
import { SessionMetricsTracker } from "../../telemetry/index.js";
import { CostTrackingMiddleware } from "../../telemetry/index.js";
import { getDefaultHookAuditSink } from "../../hooks/index.js";
import { parsePositiveInteger, parseNonNegativeInteger } from "../parsers.js";

export interface DebugAgentsOptions {
  session: string;
}

export interface DebugSearchOptions {
  session: string;
}

export interface DebugTokensOptions {
  session: string;
}

export interface DebugHooksOptions {
  limit?: number;
}

export interface DebugPruneOptions {
  tokensMaxAgeDays: number;
  progressMaxAgeDays: number;
  skillsMaxAgeDays: number;
}

export interface DebugCommands {
  register: (program: Command) => void;
}

export const createDebugCommands = (options: {
  container: Container;
  stdout: Pick<NodeJS.WriteStream, "write">;
  telemetryTracker?: SessionMetricsTracker;
  progressReports?: ProgressReportPipeline;
  skillEffectiveness?: SkillEffectivenessStore;
  tokenCostTracker?: CostTrackingMiddleware;
}): DebugCommands => {
  const container = options.container;
  const stdout = options.stdout;
  const telemetryTracker = options.telemetryTracker;
  const progressReports = options.progressReports;
  const skillEffectiveness = options.skillEffectiveness;
  const tokenCostTracker = options.tokenCostTracker;

  const register = (program: Command): void => {
    const debug = program
      .command("debug")
      .description("Debug observability subsystems");

    debug
      .command("agents")
      .description("Show per-agent execution metrics for a session")
      .option("-s, --session <sessionId>", "Session id", "default-session")
      .action((cmdOptions: DebugAgentsOptions) => {
        const tracker = telemetryTracker ?? new SessionMetricsTracker();
        const reports =
          progressReports?.latestByAgent(cmdOptions.session) ?? [];
        const events = tracker
          .listSessionEvents(cmdOptions.session)
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
              sessionId: cmdOptions.session,
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
                failures: skills.reduce(
                  (sum, skill) => sum + skill.failures,
                  0,
                ),
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
        const memory = container.resolveOr(
          TOKENS.MemoryManager as Token<MemoryManager>,
          undefined as unknown as MemoryManager,
        );
        const entries = memory?.listAll() ?? [];
        const byScope = entries.reduce<Record<string, number>>(
          (acc: Record<string, number>, entry: MemoryEntry) => {
            acc[entry.scope] = (acc[entry.scope] ?? 0) + 1;
            return acc;
          },
          {},
        );

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
      .action((cmdOptions: DebugSearchOptions) => {
        const tracker = telemetryTracker ?? new SessionMetricsTracker();
        const events = tracker
          .listSessionEvents(cmdOptions.session)
          .filter(
            (event): event is TelemetrySearchRunEvent =>
              event.kind === "search_run",
          );

        const searchEngine = container.resolveOr(
          TOKENS.SearchEngine as Token<SearchEngine>,
          undefined as unknown as SearchEngine,
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

        const errors = orderedEvents.filter(
          (event) => event.error !== undefined,
        );

        stdout.write(
          `${JSON.stringify(
            {
              sessionId: cmdOptions.session,
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
      .action((cmdOptions: DebugTokensOptions) => {
        const cost = tokenCostTracker ?? new CostTrackingMiddleware();
        const summary = cost.summarizeSession(cmdOptions.session);
        stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      });

    debug
      .command("hooks")
      .description("Show hook audit history")
      .option(
        "-l, --limit <count>",
        "Max events to print",
        parsePositiveInteger,
      )
      .action((cmdOptions: DebugHooksOptions) => {
        const sink = getDefaultHookAuditSink();
        const events = sink.snapshot();
        const limitedEvents =
          cmdOptions.limit !== undefined
            ? events.slice(-cmdOptions.limit)
            : events;

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
      .action((cmdOptions: DebugPruneOptions) => {
        const tokens = (tokenCostTracker ?? new CostTrackingMiddleware()).prune(
          {
            maxAgeDays: cmdOptions.tokensMaxAgeDays,
          },
        );
        const progress = (
          progressReports ?? new ProgressReportPipeline()
        ).prune({ maxAgeDays: cmdOptions.progressMaxAgeDays });
        const skills = (
          skillEffectiveness ?? new SkillEffectivenessStore()
        ).prune({ maxAgeDays: cmdOptions.skillsMaxAgeDays });

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
      });
  };

  return { register };
};
