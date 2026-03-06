import type { SkillManifest } from "./schema.js";

export interface SkillValidationIssue {
  readonly code:
    | "duplicate_id"
    | "invalid_trigger"
    | "duplicate_trigger"
    | "duplicate_allowed_agent"
    | "invalid_allowed_agent";
  readonly message: string;
  readonly skillId?: string;
  readonly trigger?: string;
}

export interface SkillManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SkillValidationIssue[];
}

const MAX_TRIGGER_LENGTH = 120;
const MAX_AGENT_ID_LENGTH = 64;

const hasControlCharacters = (value: string): boolean => {
  for (const char of value) {
    if (char.charCodeAt(0) < 32) {
      return true;
    }
  }

  return false;
};

const normalize = (value: string): string => value.trim().toLowerCase();

export function validateSkillManifest(
  manifest: SkillManifest,
): SkillManifestValidationResult {
  const errors: SkillValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (const skill of manifest.skills) {
    const normalizedId = normalize(skill.id);
    if (seenIds.has(normalizedId)) {
      errors.push({
        code: "duplicate_id",
        skillId: skill.id,
        message: `Duplicate skill id: ${skill.id}`,
      });
    } else {
      seenIds.add(normalizedId);
    }

    const seenTriggers = new Set<string>();

    for (const trigger of skill.triggers) {
      const normalizedTrigger = normalize(trigger);

      if (seenTriggers.has(normalizedTrigger)) {
        errors.push({
          code: "duplicate_trigger",
          skillId: skill.id,
          trigger,
          message: `Duplicate trigger '${trigger}' in skill ${skill.id}`,
        });
      } else {
        seenTriggers.add(normalizedTrigger);
      }

      if (
        normalizedTrigger.length === 0 ||
        normalizedTrigger.length > MAX_TRIGGER_LENGTH ||
        hasControlCharacters(normalizedTrigger)
      ) {
        errors.push({
          code: "invalid_trigger",
          skillId: skill.id,
          trigger,
          message: `Invalid trigger '${trigger}' in skill ${skill.id}`,
        });
      }
    }

    const seenAllowedAgents = new Set<string>();
    for (const allowedAgent of skill.permissions.allowedAgents ?? []) {
      const normalizedAgent = normalize(allowedAgent);

      if (seenAllowedAgents.has(normalizedAgent)) {
        errors.push({
          code: "duplicate_allowed_agent",
          skillId: skill.id,
          message: `Duplicate allowed agent '${allowedAgent}' in skill ${skill.id}`,
        });
      } else {
        seenAllowedAgents.add(normalizedAgent);
      }

      if (
        normalizedAgent.length === 0 ||
        normalizedAgent.length > MAX_AGENT_ID_LENGTH ||
        hasControlCharacters(normalizedAgent)
      ) {
        errors.push({
          code: "invalid_allowed_agent",
          skillId: skill.id,
          message: `Invalid allowed agent '${allowedAgent}' in skill ${skill.id}`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
