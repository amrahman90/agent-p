import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";

import { type SkillManifest, skillManifestSchema } from "./schema.js";
import { validateSkillManifest } from "./validator.js";

export const DEFAULT_SKILLS_MANIFEST_PATH = "src/skills/skills.json";
export const DIST_SKILLS_MANIFEST_PATH = "dist/src/skills/skills.json";
const ANSI_CODE_PATTERN = /\[[0-9;]*m/g;

export interface LoadSkillManifestOptions {
  readonly cwd?: string;
  readonly manifestPath?: string;
}

type SkillActivation = SkillManifest["skills"][number]["activation"];
type SkillPriority = SkillManifest["skills"][number]["priority"];
type SkillContextLoad = SkillManifest["skills"][number]["contextLoad"];

interface FrontmatterTriggerConfig {
  readonly keywords?: readonly string[];
  readonly intentPatterns?: readonly string[];
  readonly filePatterns?: readonly string[];
  readonly contentPatterns?: readonly string[];
}

interface FrontmatterMetadata {
  readonly triggers?: FrontmatterTriggerConfig;
  readonly activation?: SkillActivation;
  readonly priority?: SkillPriority;
  readonly contextLoad?: SkillContextLoad;
}

interface LegacyTriggerConfig {
  readonly promptTriggers?: {
    readonly keywords?: readonly string[];
    readonly intentPatterns?: readonly string[];
  };
  readonly fileTriggers?: {
    readonly pathPatterns?: readonly string[];
    readonly contentPatterns?: readonly string[];
  };
  readonly activation?: SkillActivation;
  readonly priority?: SkillPriority;
  readonly contextLoad?: SkillContextLoad;
}

interface TriggerSourceHints {
  readonly frontmatterPath?: string;
  readonly triggersPath?: string;
}

interface RawSkillRecord {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  domains?: unknown;
  triggers?: unknown;
  activation?: unknown;
  priority?: unknown;
  contextLoad?: unknown;
  permissions?: unknown;
  triggerSources?: unknown;
}

export class SkillManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillManifestValidationError";
  }
}

export function resolveSkillManifestPath(
  options: LoadSkillManifestOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath = options.manifestPath;

  if (manifestPath === undefined) {
    const sourcePath = join(cwd, DEFAULT_SKILLS_MANIFEST_PATH);
    if (existsSync(sourcePath)) {
      return sourcePath;
    }

    const distPath = join(cwd, DIST_SKILLS_MANIFEST_PATH);
    if (existsSync(distPath)) {
      return distPath;
    }

    return sourcePath;
  }

  if (isAbsolute(manifestPath)) {
    return manifestPath;
  }

  return join(cwd, manifestPath);
}

export function loadSkillManifest(
  options: LoadSkillManifestOptions = {},
): SkillManifest {
  const path = resolveSkillManifestPath(options);
  const manifestDir = dirname(path);

  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (error: unknown) {
    throw new SkillManifestValidationError(
      `Failed to read skill manifest at ${path}: ${toErrorMessage(error)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (error: unknown) {
    throw new SkillManifestValidationError(
      `Invalid JSON in skill manifest at ${path}: ${toErrorMessage(error)}`,
    );
  }

  const enrichedJson = hydrateManifestWithTriggerSources(
    parsedJson,
    manifestDir,
  );

  const parsed = skillManifestSchema.safeParse(enrichedJson);
  if (!parsed.success) {
    throw new SkillManifestValidationError(
      `Invalid skill manifest at ${path}: ${parsed.error.message}`,
    );
  }

  const semanticValidation = validateSkillManifest(parsed.data);
  if (!semanticValidation.valid) {
    throw new SkillManifestValidationError(
      `Invalid skill manifest at ${path}: ${semanticValidation.errors
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

function hydrateManifestWithTriggerSources(
  value: unknown,
  manifestDir: string,
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const skills = value["skills"];
  if (!Array.isArray(skills)) {
    return value;
  }

  const nextSkills = skills.map((skill) =>
    hydrateSkillFromTriggerSources(skill, manifestDir),
  );

  return {
    ...value,
    skills: nextSkills,
  };
}

function hydrateSkillFromTriggerSources(
  value: unknown,
  manifestDir: string,
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const skill = { ...value } as RawSkillRecord;
  const sourceHints = parseTriggerSourceHints(
    skill.triggerSources,
    manifestDir,
  );

  const frontmatter = readFrontmatter(sourceHints.frontmatterPath);
  const legacy = readLegacyTriggers(sourceHints.triggersPath);

  const frontmatterTriggers = extractFrontmatterTriggers(frontmatter);
  const legacyTriggers = extractLegacyTriggers(legacy);
  const hasManifestTriggers =
    Array.isArray(skill.triggers) && skill.triggers.length > 0;

  const triggers = hasManifestTriggers
    ? sanitizeStringList(skill.triggers)
    : frontmatterTriggers.length > 0
      ? frontmatterTriggers
      : legacyTriggers;

  const activation =
    skill.activation ?? frontmatter?.activation ?? legacy?.activation;
  const priority = skill.priority ?? frontmatter?.priority ?? legacy?.priority;
  const contextLoad =
    skill.contextLoad ?? frontmatter?.contextLoad ?? legacy?.contextLoad;

  return {
    ...skill,
    name:
      typeof skill.name === "string"
        ? sanitizeSkillText(skill.name)
        : skill.name,
    description:
      typeof skill.description === "string"
        ? sanitizeSkillText(skill.description)
        : skill.description,
    domains: Array.isArray(skill.domains)
      ? sanitizeStringList(skill.domains)
      : skill.domains,
    triggers,
    activation,
    priority,
    contextLoad,
  };
}

function parseTriggerSourceHints(
  value: unknown,
  manifestDir: string,
): TriggerSourceHints {
  if (!isRecord(value)) {
    return {};
  }

  const frontmatterPath =
    typeof value.frontmatterPath === "string"
      ? resolveRelativePath(manifestDir, value.frontmatterPath)
      : undefined;
  const triggersPath =
    typeof value.triggersPath === "string"
      ? resolveRelativePath(manifestDir, value.triggersPath)
      : undefined;

  return {
    ...(frontmatterPath !== undefined ? { frontmatterPath } : {}),
    ...(triggersPath !== undefined ? { triggersPath } : {}),
  };
}

function readFrontmatter(path: string | undefined): FrontmatterMetadata | null {
  if (!path || !existsSync(path)) {
    return null;
  }

  const content = readTextFile(path);
  const parsed = parseYamlFrontmatter(content, path);
  if (!parsed || !isRecord(parsed)) {
    return null;
  }

  return {
    ...(isRecord(parsed["triggers"])
      ? { triggers: parseFrontmatterTriggerConfig(parsed["triggers"]) }
      : {}),
    ...(parsed["activation"] === "auto" || parsed["activation"] === "manual"
      ? { activation: parsed["activation"] }
      : {}),
    ...(parsed["priority"] === "low" ||
    parsed["priority"] === "medium" ||
    parsed["priority"] === "high"
      ? { priority: parsed["priority"] }
      : {}),
    ...(parsed["contextLoad"] === "minimal" ||
    parsed["contextLoad"] === "standard" ||
    parsed["contextLoad"] === "full"
      ? { contextLoad: parsed["contextLoad"] }
      : {}),
  };
}

function parseFrontmatterTriggerConfig(
  value: unknown,
): FrontmatterTriggerConfig {
  if (!isRecord(value)) {
    return {};
  }

  return {
    keywords: sanitizeStringList(value["keywords"]),
    intentPatterns: sanitizeStringList(value["intentPatterns"]),
    filePatterns: sanitizeStringList(value["filePatterns"]),
    contentPatterns: sanitizeStringList(value["contentPatterns"]),
  };
}

function readLegacyTriggers(
  path: string | undefined,
): LegacyTriggerConfig | null {
  if (!path || !existsSync(path)) {
    return null;
  }

  const rawText = readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error: unknown) {
    throw new SkillManifestValidationError(
      `Invalid triggers.json at ${path}: ${toErrorMessage(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const promptTriggers = isRecord(parsed["promptTriggers"])
    ? {
        keywords: sanitizeStringList(parsed["promptTriggers"]["keywords"]),
        intentPatterns: sanitizeStringList(
          parsed["promptTriggers"]["intentPatterns"],
        ),
      }
    : undefined;

  const fileTriggers = isRecord(parsed["fileTriggers"])
    ? {
        pathPatterns: sanitizeStringList(
          parsed["fileTriggers"]["pathPatterns"],
        ),
        contentPatterns: sanitizeStringList(
          parsed["fileTriggers"]["contentPatterns"],
        ),
      }
    : undefined;

  return {
    ...(promptTriggers !== undefined ? { promptTriggers } : {}),
    ...(fileTriggers !== undefined ? { fileTriggers } : {}),
    ...(parsed["activation"] === "auto" || parsed["activation"] === "manual"
      ? { activation: parsed["activation"] }
      : {}),
    ...(parsed["priority"] === "low" ||
    parsed["priority"] === "medium" ||
    parsed["priority"] === "high"
      ? { priority: parsed["priority"] }
      : {}),
    ...(parsed["contextLoad"] === "minimal" ||
    parsed["contextLoad"] === "standard" ||
    parsed["contextLoad"] === "full"
      ? { contextLoad: parsed["contextLoad"] }
      : {}),
  };
}

function parseYamlFrontmatter(content: string, path: string): unknown {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return null;
  }

  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(trimmed);
  if (!match) {
    return null;
  }

  const frontmatterBody = match[1];
  if (frontmatterBody === undefined) {
    return null;
  }

  try {
    return parseYaml(frontmatterBody);
  } catch (error: unknown) {
    throw new SkillManifestValidationError(
      `Invalid SKILL.md frontmatter at ${path}: ${toErrorMessage(error)}`,
    );
  }
}

function extractFrontmatterTriggers(
  frontmatter: FrontmatterMetadata | null,
): string[] {
  if (!frontmatter?.triggers) {
    return [];
  }

  return uniqueStrings([
    ...(frontmatter.triggers.keywords ?? []),
    ...(frontmatter.triggers.intentPatterns ?? []),
    ...(frontmatter.triggers.filePatterns ?? []),
    ...(frontmatter.triggers.contentPatterns ?? []),
  ]);
}

function extractLegacyTriggers(legacy: LegacyTriggerConfig | null): string[] {
  if (!legacy) {
    return [];
  }

  return uniqueStrings([
    ...(legacy.promptTriggers?.keywords ?? []),
    ...(legacy.promptTriggers?.intentPatterns ?? []),
    ...(legacy.fileTriggers?.pathPatterns ?? []),
    ...(legacy.fileTriggers?.contentPatterns ?? []),
  ]);
}

function sanitizeSkillText(value: string): string {
  return stripControlCharacters(
    value.normalize("NFKC").replace(ANSI_CODE_PATTERN, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function stripControlCharacters(value: string): string {
  let result = "";

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isForbiddenControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;

    if (!isForbiddenControl) {
      result += char;
    }
  }

  return result;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => sanitizeSkillText(entry))
      .filter((entry) => entry.length > 0),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function resolveRelativePath(baseDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }

  return join(baseDir, filePath);
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    throw new SkillManifestValidationError(
      `Failed to read trigger source at ${path}: ${toErrorMessage(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown error";
}
