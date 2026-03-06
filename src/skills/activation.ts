import { SkillRegistry } from "./registry.js";
import type { SkillDefinition, SkillPriority } from "./schema.js";

const DEFAULT_SUGGESTION_LIMIT = 5;
const ANSI_CODE_PATTERN = /\[[0-9;]*m/g;

const PRIORITY_SCORE: Record<SkillPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface SuggestSkillsRequest {
  readonly query: string;
  readonly domains?: readonly string[];
  readonly filePaths?: readonly string[];
  readonly includeManual?: boolean;
  readonly limit?: number;
  readonly agentId?: string;
}

export interface SkillSuggestion {
  readonly skill: SkillDefinition;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface LoadSkillRequest {
  readonly skillId: string;
  readonly agentId?: string;
}

const stripControlCharacters = (value: string): string => {
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
};

const sanitizeSkillContent = (value: string): string =>
  stripControlCharacters(
    value.normalize("NFKC").replace(ANSI_CODE_PATTERN, ""),
  ).trim();

const normalizeText = (value: string): string =>
  sanitizeSkillContent(value).toLowerCase();

const normalizePath = (value: string): string =>
  sanitizeSkillContent(value).toLowerCase().replace(/\\/g, "/");

const unique = (values: readonly string[]): string[] =>
  Array.from(new Set(values));

const isAllowedForAgent = (
  skill: SkillDefinition,
  agentId: string | undefined,
): boolean => {
  const allowlist = skill.permissions.allowedAgents;
  if (!allowlist || allowlist.length === 0) {
    return true;
  }

  if (!agentId) {
    return false;
  }

  const normalized = normalizeText(agentId);
  return allowlist.some((entry) => normalizeText(entry) === normalized);
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasWildcard = (value: string): boolean =>
  value.includes("*") || value.includes("?");

const wildcardToRegExp = (value: string): RegExp => {
  const escaped = escapeRegExp(value);
  const pattern = escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${pattern}$`);
};

const hasTriggerInQuery = (query: string, trigger: string): boolean => {
  const normalizedTrigger = normalizeText(trigger);
  if (normalizedTrigger.length === 0) {
    return false;
  }

  if (normalizedTrigger.includes(" ")) {
    return query.includes(normalizedTrigger);
  }

  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedTrigger)}([^a-z0-9]|$)`,
  );
  return pattern.test(query);
};

const hasTriggerInPaths = (
  filePaths: readonly string[],
  trigger: string,
): boolean => {
  const normalizedTrigger = normalizePath(trigger);
  const normalizedPaths = filePaths.map(normalizePath);

  if (hasWildcard(normalizedTrigger)) {
    const pattern = wildcardToRegExp(normalizedTrigger);
    return normalizedPaths.some((path) => pattern.test(path));
  }

  if (normalizedTrigger.startsWith(".")) {
    return normalizedPaths.some((path) => path.endsWith(normalizedTrigger));
  }

  return normalizedPaths.some((path) => path.includes(normalizedTrigger));
};

function buildSuggestion(
  skill: SkillDefinition,
  request: SuggestSkillsRequest,
): SkillSuggestion | null {
  if (!request.includeManual && skill.activation === "manual") {
    return null;
  }

  if (!isAllowedForAgent(skill, request.agentId)) {
    return null;
  }

  const query = normalizeText(request.query);
  const filePaths = request.filePaths ?? [];
  const requestedDomains = new Set((request.domains ?? []).map(normalizeText));

  let score = PRIORITY_SCORE[skill.priority];
  const reasons: string[] = [];

  for (const trigger of unique(skill.triggers)) {
    if (hasTriggerInQuery(query, trigger)) {
      score += 3;
      reasons.push(`query matched trigger '${trigger}'`);
      continue;
    }

    if (hasTriggerInPaths(filePaths, trigger)) {
      score += 4;
      reasons.push(`file paths matched trigger '${trigger}'`);
    }
  }

  const matchedDomains = skill.domains.filter((domain) =>
    requestedDomains.has(normalizeText(domain)),
  );

  if (matchedDomains.length > 0) {
    score += matchedDomains.length * 2;
    reasons.push(`domain matched (${matchedDomains.join(", ")})`);
  }

  if (reasons.length === 0) {
    return null;
  }

  return { skill, score, reasons };
}

export function suggestSkills(
  registry: SkillRegistry,
  request: SuggestSkillsRequest,
): SkillSuggestion[] {
  const limit = Math.max(1, request.limit ?? DEFAULT_SUGGESTION_LIMIT);

  const suggestions = registry
    .list()
    .map((skill) => buildSuggestion(skill, request))
    .filter((suggestion): suggestion is SkillSuggestion => suggestion !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.skill.id.localeCompare(right.skill.id);
    });

  return suggestions.slice(0, limit);
}

export const suggest_skills = suggestSkills;

export function loadSkill(
  registry: SkillRegistry,
  request: LoadSkillRequest,
): SkillDefinition {
  const skill = registry.get(request.skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${request.skillId}`);
  }

  if (!isAllowedForAgent(skill, request.agentId)) {
    const agentLabel = request.agentId ?? "unknown";
    throw new Error(
      `Skill '${request.skillId}' is not allowed for agent '${agentLabel}'`,
    );
  }

  return skill;
}

export const load_skill = loadSkill;

export class SkillActivator {
  constructor(private readonly registry: SkillRegistry) {}

  suggest(request: SuggestSkillsRequest): SkillSuggestion[] {
    return suggestSkills(this.registry, request);
  }

  activate(request: SuggestSkillsRequest): SkillDefinition[] {
    return this.suggest(request).map((suggestion) => suggestion.skill);
  }

  load(request: LoadSkillRequest): SkillDefinition {
    return loadSkill(this.registry, request);
  }
}
