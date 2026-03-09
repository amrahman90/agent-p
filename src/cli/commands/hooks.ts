import { Command } from "commander";

import { loadConfig } from "../../config/load-config.js";
import type { Container, Token } from "../../core/container.js";
import { TOKENS } from "../../core/container.js";
import { SelfLearningPatternStore } from "../../evals/index.js";
import {
  NotificationHook,
  PostToolUseHook,
  PreToolUseHook,
  SessionStartHook,
  StopHook,
  getDefaultHookAuditSink,
} from "../../hooks/index.js";
import {
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
} from "../../hooks/index.js";
import { SessionMetricsTracker } from "../../telemetry/index.js";
import {
  parseJsonObject,
  parseJsonUnknown,
  parseHookPlatform,
  parsePositiveInteger,
} from "../parsers.js";

export interface HooksConfigOptions {
  config?: string;
}

export interface HooksAuditLogOptions {
  limit?: number;
  clear?: boolean;
}

export interface HooksSessionStartOptions {
  query?: string;
  config?: string;
  platform: "neutral" | "claude" | "opencode";
}

export interface HooksPreToolUseOptions {
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  blockedPattern?: string[];
  dryRun?: boolean;
  config?: string;
  platform: "neutral" | "claude" | "opencode";
}

export interface HooksPostToolUseOptions {
  toolInput: Record<string, unknown>;
  toolResponse?: unknown;
  toolUseId?: string;
  blockPattern?: string[];
  config?: string;
  platform: "neutral" | "claude" | "opencode";
}

export interface HooksStopOptions {
  stopHookActive?: boolean;
  lastAssistantMessage?: string;
  completionSignal?: string;
  config?: string;
  platform: "neutral" | "claude" | "opencode";
}

export interface HooksNotificationOptions {
  title?: string;
  config?: string;
  platform: "neutral" | "claude" | "opencode";
}

export interface HookCommands {
  register: (program: Command) => void;
}

export const createHookCommands = (options: {
  container: Container;
  stdout: Pick<NodeJS.WriteStream, "write">;
}): HookCommands => {
  const container = options.container;
  const stdout = options.stdout;

  const register = (program: Command): void => {
    program
      .command("hooks:config")
      .description("Print effective hooks policy and audit config")
      .option("-c, --config <path>", "Custom config path")
      .action((cmdOptions: HooksConfigOptions) => {
        const config = loadConfig(cmdOptions.config);
        stdout.write(`${JSON.stringify(config.hooks, null, 2)}\n`);
      });

    program
      .command("hooks:audit-log")
      .description("Print in-memory hook audit events")
      .option(
        "-l, --limit <count>",
        "Max events to print",
        parsePositiveInteger,
      )
      .option("--clear", "Clear in-memory audit log after printing")
      .action((cmdOptions: HooksAuditLogOptions) => {
        const sink = getDefaultHookAuditSink();
        const events = sink.snapshot();
        const limitedEvents =
          cmdOptions.limit !== undefined
            ? events.slice(-cmdOptions.limit)
            : events;
        stdout.write(`${JSON.stringify(limitedEvents, null, 2)}\n`);

        if (cmdOptions.clear) {
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
      .action((sessionId: string, cmdOptions: HooksSessionStartOptions) => {
        const config = loadConfig(cmdOptions.config);
        const hook = container.resolveOr(
          TOKENS.SessionStartHook as Token<SessionStartHook>,
          new SessionStartHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            ...(cmdOptions.query !== undefined
              ? { query: cmdOptions.query }
              : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.sessionStart,
          },
          {
            audit: config.hooks.audit,
            platform: cmdOptions.platform,
          },
        );

        const output =
          cmdOptions.platform === "claude"
            ? toClaudeSessionStartOutput(result)
            : cmdOptions.platform === "opencode"
              ? toOpenCodeSessionStartOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      });

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
          cmdOptions: HooksPreToolUseOptions,
        ) => {
          const config = loadConfig(cmdOptions.config);
          const hook = container.resolveOr(
            TOKENS.PreToolUseHook as Token<PreToolUseHook>,
            new PreToolUseHook(),
          );
          const result = hook.execute(
            {
              sessionId,
              toolName,
              toolInput: cmdOptions.toolInput,
              ...(cmdOptions.toolUseId !== undefined
                ? { toolUseId: cmdOptions.toolUseId }
                : {}),
            },
            {
              enabled: config.hooks.enabled && config.hooks.preToolUse,
              mode: cmdOptions.dryRun ? "dry-run" : "enforce",
              blockedPatterns: cmdOptions.blockedPattern ?? [],
            },
            {
              policy: config.hooks.policy,
              audit: config.hooks.audit,
              platform: cmdOptions.platform,
            },
          );

          const output =
            cmdOptions.platform === "claude"
              ? toClaudePreToolUseOutput(result)
              : cmdOptions.platform === "opencode"
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
      .option(
        "--tool-response <json>",
        "Tool response as JSON",
        parseJsonUnknown,
      )
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
          cmdOptions: HooksPostToolUseOptions,
        ) => {
          const config = loadConfig(cmdOptions.config);
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
              toolInput: cmdOptions.toolInput,
              ...(cmdOptions.toolResponse !== undefined
                ? { toolResponse: cmdOptions.toolResponse }
                : {}),
              ...(cmdOptions.toolUseId !== undefined
                ? { toolUseId: cmdOptions.toolUseId }
                : {}),
            },
            {
              enabled: config.hooks.enabled && config.hooks.postToolUse,
              blockPatterns: cmdOptions.blockPattern ?? [],
            },
            {
              policy: config.hooks.policy,
              audit: config.hooks.audit,
              platform: cmdOptions.platform,
              telemetryRecorder,
              selfLearningRecorder,
            },
          );

          const output =
            cmdOptions.platform === "claude"
              ? toClaudePostToolUseOutput(result)
              : cmdOptions.platform === "opencode"
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
      .action((sessionId: string, cmdOptions: HooksStopOptions) => {
        const config = loadConfig(cmdOptions.config);
        const hook = container.resolveOr(
          TOKENS.StopHook as Token<StopHook>,
          new StopHook(),
        );
        const result = hook.execute(
          {
            sessionId,
            stopHookActive: cmdOptions.stopHookActive ?? false,
            ...(cmdOptions.lastAssistantMessage !== undefined
              ? { lastAssistantMessage: cmdOptions.lastAssistantMessage }
              : {}),
          },
          {
            enabled: config.hooks.enabled && config.hooks.stop,
            ...(cmdOptions.completionSignal !== undefined
              ? { completionSignal: cmdOptions.completionSignal }
              : {}),
          },
          {
            policy: config.hooks.policy,
            audit: config.hooks.audit,
            platform: cmdOptions.platform,
          },
        );

        const output =
          cmdOptions.platform === "claude"
            ? toClaudeStopOutput(result)
            : cmdOptions.platform === "opencode"
              ? toOpenCodeStopOutput(result)
              : result;

        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      });

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
          cmdOptions: HooksNotificationOptions,
        ) => {
          const config = loadConfig(cmdOptions.config);
          const hook = container.resolveOr(
            TOKENS.NotificationHook as Token<NotificationHook>,
            new NotificationHook(),
          );
          const result = hook.execute(
            {
              sessionId,
              notificationType,
              message,
              ...(cmdOptions.title !== undefined
                ? { title: cmdOptions.title }
                : {}),
            },
            {
              enabled: config.hooks.enabled && config.hooks.notification,
            },
            {
              policy: config.hooks.policy,
              audit: config.hooks.audit,
              platform: cmdOptions.platform,
            },
          );

          const output =
            cmdOptions.platform === "claude"
              ? toClaudeNotificationOutput(result)
              : cmdOptions.platform === "opencode"
                ? toOpenCodeNotificationOutput(result)
                : result;

          stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        },
      );
  };

  return { register };
};
