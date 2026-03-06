import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ZodError } from "zod";
import { parse as parseYaml } from "yaml";

import { agentPConfigSchema, type AgentPConfig } from "./schema.js";

export const DEFAULT_CONFIG_PATH = ".agent-p/config.yaml";

export class ConfigValidationError extends Error {
  readonly issues: ZodError["issues"];

  constructor(error: ZodError) {
    super("Config validation failed");
    this.name = "ConfigValidationError";
    this.issues = error.issues;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const migrateHooksPolicyConfig = (rawConfig: unknown): unknown => {
  const config = asRecord(rawConfig);
  if (config === undefined) {
    return rawConfig;
  }

  const hooks = asRecord(config.hooks);
  if (hooks === undefined) {
    return config;
  }

  const policy = asRecord(hooks.policy);
  if (policy === undefined) {
    return config;
  }

  const hasStrictMode = typeof policy.strictMode === "boolean";
  const hasProfile = typeof policy.profile === "string";

  if (!hasStrictMode && !hasProfile) {
    return config;
  }

  if (hasStrictMode) {
    policy.profile = policy.strictMode === true ? "strict" : "balanced";
    return config;
  }

  policy.strictMode = policy.profile === "strict";
  return config;
};

export const loadConfig = (
  configPath: string = DEFAULT_CONFIG_PATH,
): AgentPConfig => {
  const absolutePath = resolve(configPath);

  if (!existsSync(absolutePath)) {
    return agentPConfigSchema.parse({});
  }

  const rawText = readFileSync(absolutePath, "utf8");
  const parsedYaml = parseYaml(rawText) ?? {};
  const migratedConfig = migrateHooksPolicyConfig(parsedYaml);
  const parsedConfig = agentPConfigSchema.safeParse(migratedConfig);

  if (!parsedConfig.success) {
    throw new ConfigValidationError(parsedConfig.error);
  }

  return parsedConfig.data;
};
