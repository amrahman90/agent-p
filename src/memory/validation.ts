const assertNonEmpty = (value: string, fieldName: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return normalized;
};

export const validateScopeId = (scopeId: string): string => {
  return assertNonEmpty(scopeId, "scopeId");
};

export const validateMemoryKey = (key: string): string => {
  return assertNonEmpty(key, "memory key");
};

export const validateAgentId = (agentId: string): string => {
  return assertNonEmpty(agentId, "agentId");
};
