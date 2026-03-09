import { hookPlatformSchema } from "../hooks/index.js";
import type { D3AnalysisMode, D3WorkflowMode } from "../workflow/index.js";

export const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received '${value}'`);
  }

  return parsed;
};

export const parseNonNegativeInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received '${value}'`);
  }

  return parsed;
};

export const parseProbability = (value: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a number between 0 and 1, received '${value}'`);
  }

  return parsed;
};

export const parseScale1to5 = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    throw new Error(`Expected an integer between 1 and 5, received '${value}'`);
  }

  return parsed;
};

export const parseJsonObject = (value: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Expected valid JSON object, received '${value}'`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected valid JSON object, received '${value}'`);
  }

  return parsed as Record<string, unknown>;
};

export const parseJsonUnknown = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Expected valid JSON, received '${value}'`);
  }
};

export const parseHookPlatform = (
  value: string,
): "neutral" | "claude" | "opencode" => hookPlatformSchema.parse(value);

export const parseWorkflowMode = (value: string): D3WorkflowMode => {
  if (value === "static" || value === "dynamic" || value === "quick") {
    return value;
  }

  throw new Error(
    `Expected workflow mode static|dynamic|quick, received '${value}'`,
  );
};

export const parseAnalysisMode = (value: string): D3AnalysisMode => {
  if (value === "quick" || value === "deep") {
    return value;
  }

  throw new Error(`Expected analysis mode quick|deep, received '${value}'`);
};
