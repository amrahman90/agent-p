import { Command } from "commander";

import type { Container, Token } from "../../core/container.js";
import { EvaluationEngine, type EvaluationInput } from "../../evals/index.js";
import { TOKENS } from "../../core/container.js";
import { SessionMetricsTracker } from "../../telemetry/index.js";
import { asRate } from "../helpers.js";
import { parseProbability } from "../parsers.js";

export interface StatsCommandOptions {
  session: string;
}

export interface EvalCommandOptions {
  session: string;
  trustScore?: number;
  activationAccuracy?: number;
  retryRate?: number;
}

export interface StatsCommands {
  register: (program: Command) => void;
}

export const createStatsCommands = (options: {
  container: Container;
  stdout: Pick<NodeJS.WriteStream, "write">;
}): StatsCommands => {
  const container = options.container;
  const stdout = options.stdout;

  const register = (program: Command): void => {
    program
      .command("stats")
      .description("Show aggregated session telemetry metrics")
      .option("-s, --session <sessionId>", "Session id", "default-session")
      .action((cmdOptions: StatsCommandOptions) => {
        const tracker = container.resolveOr(
          TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
          new SessionMetricsTracker(),
        );
        const summary = tracker.summarizeSession(cmdOptions.session);
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
      .action((cmdOptions: EvalCommandOptions) => {
        const tracker = container.resolveOr(
          TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
          new SessionMetricsTracker(),
        );
        const engine = container.resolveOr(
          TOKENS.EvaluationEngine as Token<EvaluationEngine>,
          new EvaluationEngine(),
        );

        const summary = tracker.summarizeSession(cmdOptions.session);
        const inferredTrust =
          summary.postToolUse.total > 0
            ? asRate(summary.postToolUse.allowed, summary.postToolUse.total)
            : 0;
        const inferredSuccessRate =
          summary.agents.totalRuns > 0
            ? asRate(summary.agents.successRuns, summary.agents.totalRuns)
            : inferredTrust;

        const input: EvaluationInput = {
          trustScore: cmdOptions.trustScore ?? inferredTrust,
          successRate: inferredSuccessRate,
          activationAccuracy: cmdOptions.activationAccuracy ?? 1,
          averageLatencyMs: summary.postToolUse.averageLatencyMs,
          retryRate: cmdOptions.retryRate ?? 0,
        };

        const evaluation = engine.evaluate(input);
        stdout.write(
          `${JSON.stringify(
            {
              sessionId: cmdOptions.session,
              input,
              evaluation,
            },
            null,
            2,
          )}\n`,
        );
      });
  };

  return { register };
};
