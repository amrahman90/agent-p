import { Command } from "commander";

import { loadConfig } from "../../config/load-config.js";
import { DatabaseManager } from "../../db/database-manager.js";

export interface ConfigCommandOptions {
  config?: string;
}

export interface ConfigCommands {
  register: (program: Command) => void;
}

export const createConfigCommands = (options: {
  stdout: Pick<NodeJS.WriteStream, "write">;
}): ConfigCommands => {
  const stdout = options.stdout;

  const register = (program: Command): void => {
    program
      .command("config:check")
      .description("Validate and print effective config")
      .option("-c, --config <path>", "Custom config path")
      .action((cmdOptions: ConfigCommandOptions) => {
        const config = loadConfig(cmdOptions.config);
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
  };

  return { register };
};
