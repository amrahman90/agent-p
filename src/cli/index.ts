import { Command } from "commander";

import { bootstrapContainer } from "../core/bootstrap.js";
import type { Container, Token } from "../core/container.js";
import { TOKENS } from "../core/container.js";
import {
  ProgressReportPipeline,
  SkillEffectivenessStore,
} from "../evals/index.js";
import { SessionMetricsTracker } from "../telemetry/index.js";
import { CostTrackingMiddleware } from "../telemetry/index.js";

import { createConfigCommands } from "./commands/config.js";
import { createStatsCommands } from "./commands/stats.js";
import { createDebugCommands } from "./commands/debug.js";
import { createHookCommands } from "./commands/hooks.js";
import { createSkillsCommands } from "./commands/skills.js";
import { createAgentCommands } from "./commands/agents.js";

export interface CliDependencies {
  readonly container?: Container;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
}

export const createCliProgram = (
  dependencies: CliDependencies = {},
): Command => {
  const container = dependencies.container ?? bootstrapContainer();
  const stdout = dependencies.stdout ?? process.stdout;

  const telemetryTracker = container.resolveOptional(
    TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
  );
  const tokenCostTracker = container.resolveOptional(
    TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
  );
  const skillEffectiveness = container.resolveOptional(
    TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
  );
  const progressReports = container.resolveOptional(
    TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
  );

  const program = new Command();

  program
    .name("agent-p")
    .description("Agentic workflow tool for software engineering tasks")
    .version("0.0.1");

  const configCommands = createConfigCommands({ stdout });
  configCommands.register(program);

  const statsCommands = createStatsCommands({ container, stdout });
  statsCommands.register(program);

  const debugCommands = createDebugCommands({
    container,
    stdout,
    ...(telemetryTracker !== undefined ? { telemetryTracker } : {}),
    ...(progressReports !== undefined ? { progressReports } : {}),
    ...(skillEffectiveness !== undefined ? { skillEffectiveness } : {}),
    ...(tokenCostTracker !== undefined ? { tokenCostTracker } : {}),
  });
  debugCommands.register(program);

  const hookCommands = createHookCommands({ container, stdout });
  hookCommands.register(program);

  const skillsCommands = createSkillsCommands({
    container,
    stdout,
    ...(skillEffectiveness !== undefined ? { skillEffectiveness } : {}),
  });
  skillsCommands.register(program);

  const agentCommands = createAgentCommands({
    container,
    stdout,
    ...(telemetryTracker !== undefined ? { telemetryTracker } : {}),
    ...(progressReports !== undefined ? { progressReports } : {}),
  });
  agentCommands.register(program);

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
