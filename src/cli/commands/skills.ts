import { Command } from "commander";

import type { Container, Token } from "../../core/container.js";
import { TOKENS } from "../../core/container.js";
import type { SkillActivator, SkillRegistry } from "../../skills/index.js";
import { load_skill } from "../../skills/index.js";
import { createCliHelpers, estimateTokens } from "../helpers.js";
import { parsePositiveInteger } from "../parsers.js";

export interface SkillsSuggestOptions {
  agent?: string;
  domains?: string[];
  files?: string[];
  includeManual?: boolean;
  limit?: number;
}

export interface SkillsLoadOptions {
  agent?: string;
}

export interface SkillsCommands {
  register: (program: Command) => void;
}

export const createSkillsCommands = (options: {
  container: Container;
  stdout: Pick<NodeJS.WriteStream, "write">;
  skillEffectiveness?: unknown;
}): SkillsCommands => {
  const container = options.container;
  const stdout = options.stdout;
  const helpers = createCliHelpers({
    skillEffectiveness: options.skillEffectiveness as never,
  });

  const register = (program: Command): void => {
    program
      .command("skills:suggest <query>")
      .description("Suggest skills for a query using trigger matching")
      .option(
        "-a, --agent <agentId>",
        "Agent id for permission-aware filtering",
      )
      .option("-d, --domains <domain...>", "Domains to bias skill ranking")
      .option("-f, --files <path...>", "File paths to match trigger patterns")
      .option("-m, --include-manual", "Include manual-only skills")
      .option(
        "-l, --limit <count>",
        "Maximum number of suggestions",
        parsePositiveInteger,
      )
      .action((query: string, cmdOptions: SkillsSuggestOptions) => {
        const startedAt = Date.now();
        const sessionId = "skills-suggest";
        const activator = container.resolve(
          TOKENS.SkillActivator as Token<SkillActivator>,
        );

        const suggestions = activator.suggest({
          query,
          ...(cmdOptions.agent !== undefined
            ? { agentId: cmdOptions.agent }
            : {}),
          ...(cmdOptions.domains !== undefined
            ? { domains: cmdOptions.domains }
            : {}),
          ...(cmdOptions.files !== undefined
            ? { filePaths: cmdOptions.files }
            : {}),
          ...(cmdOptions.includeManual !== undefined
            ? { includeManual: cmdOptions.includeManual }
            : {}),
          ...(cmdOptions.limit !== undefined
            ? { limit: cmdOptions.limit }
            : {}),
        });

        for (const suggestion of suggestions) {
          helpers.recordSkillActivation({
            sessionId,
            skillName: suggestion.skill.id,
            success: true,
            latencyMs: Math.max(0, Date.now() - startedAt),
            tokens: estimateTokens({ query, options: cmdOptions, suggestion }),
          });
        }

        stdout.write(`${JSON.stringify(suggestions, null, 2)}\n`);
      });

    program
      .command("skills:load <skillId>")
      .description("Manually load a skill by id")
      .option("-a, --agent <agentId>", "Agent id for permission-aware loading")
      .action((skillId: string, cmdOptions: SkillsLoadOptions) => {
        const startedAt = Date.now();
        const sessionId = "skills-load";
        const registry = container.resolve(
          TOKENS.SkillRegistry as Token<SkillRegistry>,
        );
        let skill;
        try {
          skill = load_skill(registry, {
            skillId,
            ...(cmdOptions.agent !== undefined
              ? { agentId: cmdOptions.agent }
              : {}),
          });
        } catch (error: unknown) {
          helpers.recordSkillActivation({
            sessionId,
            skillName: skillId,
            success: false,
            latencyMs: Math.max(0, Date.now() - startedAt),
            tokens: estimateTokens({ skillId, error: String(error) }),
          });
          throw error;
        }

        helpers.recordSkillActivation({
          sessionId,
          skillName: skill.id,
          success: true,
          latencyMs: Math.max(0, Date.now() - startedAt),
          tokens: estimateTokens(skill),
        });
        stdout.write(`${JSON.stringify(skill, null, 2)}\n`);
      });
  };

  return { register };
};
