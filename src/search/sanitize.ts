import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import type {
  SanitizedSearchRequest,
  SearchMode,
  SearchRequest,
} from "./types.js";

export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 500;
export const DEFAULT_MAX_QUERY_LENGTH = 256;

const ALLOWED_REGEX_FLAGS = new Set(["i", "m", "s", "u"]);

const normalizeForComparison = (value: string): string => {
  return process.platform === "win32" ? value.toLowerCase() : value;
};

const isWithinRoot = (
  workspaceRoot: string,
  candidatePath: string,
): boolean => {
  const normalizedWorkspace = normalizeForComparison(workspaceRoot);
  const normalizedCandidate = normalizeForComparison(candidatePath);

  if (normalizedWorkspace === normalizedCandidate) {
    return true;
  }

  return normalizedCandidate.startsWith(`${normalizedWorkspace}${sep}`);
};

export const sanitizeSearchQuery = (
  query: string,
  maxQueryLength: number = DEFAULT_MAX_QUERY_LENGTH,
): string => {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error("search query must be a non-empty string");
  }

  if (normalizedQuery.includes("\0")) {
    throw new Error("search query contains invalid null byte");
  }

  if (normalizedQuery.length > maxQueryLength) {
    throw new Error(`search query exceeds max length of ${maxQueryLength}`);
  }

  return normalizedQuery;
};

export const sanitizeSearchLimit = (
  limit: number | undefined,
  maxLimit: number = MAX_SEARCH_LIMIT,
): number => {
  if (limit === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("search limit must be a positive integer");
  }

  if (limit > maxLimit) {
    throw new Error(`search limit exceeds maximum of ${maxLimit}`);
  }

  return limit;
};

export const sanitizeRegexFlags = (
  mode: SearchMode,
  regexFlags: string | undefined,
): string => {
  if (!regexFlags || regexFlags.length === 0) {
    return "";
  }

  if (mode !== "regex") {
    throw new Error("regex flags are only allowed when mode is 'regex'");
  }

  const uniqueFlags = new Set<string>();
  for (const flag of regexFlags) {
    if (!ALLOWED_REGEX_FLAGS.has(flag)) {
      throw new Error(`unsupported regex flag: ${flag}`);
    }

    uniqueFlags.add(flag);
  }

  return [...uniqueFlags].sort().join("");
};

/**
 * Validates and normalizes search root so search execution cannot escape the workspace.
 */
export const resolveSearchRoot = (
  workspaceRoot: string,
  root: string | undefined,
): string => {
  if (workspaceRoot.includes("\0")) {
    throw new Error("workspace root contains invalid null byte");
  }

  if (!existsSync(workspaceRoot)) {
    throw new Error(`workspace root does not exist: ${workspaceRoot}`);
  }

  const workspaceReal = realpathSync(workspaceRoot);

  const rootInput = root?.trim() || ".";
  if (rootInput.includes("\0")) {
    throw new Error("search root contains invalid null byte");
  }

  const resolvedCandidate = isAbsolute(rootInput)
    ? resolve(rootInput)
    : resolve(workspaceReal, rootInput);

  if (!existsSync(resolvedCandidate)) {
    throw new Error(`search root does not exist: ${resolvedCandidate}`);
  }

  const candidateReal = realpathSync(resolvedCandidate);
  if (!isWithinRoot(workspaceReal, candidateReal)) {
    throw new Error("search root must stay within workspace root");
  }

  if (!statSync(candidateReal).isDirectory()) {
    throw new Error(`search root is not a directory: ${candidateReal}`);
  }

  return candidateReal;
};

/**
 * Produces a fully validated request shape for Stage 1 search execution.
 */
export const sanitizeSearchRequest = (
  request: SearchRequest,
  workspaceRoot: string,
  options?: {
    readonly maxQueryLength?: number;
    readonly maxLimit?: number;
  },
): SanitizedSearchRequest => {
  const mode: SearchMode = request.mode ?? "literal";
  const caseSensitive = request.caseSensitive ?? false;
  const regexFlags = sanitizeRegexFlags(mode, request.regexFlags);

  if (caseSensitive && regexFlags.includes("i")) {
    throw new Error(
      "caseSensitive=true cannot be combined with regex flag 'i'",
    );
  }

  return {
    query: sanitizeSearchQuery(request.query, options?.maxQueryLength),
    resolvedRoot: resolveSearchRoot(workspaceRoot, request.root),
    limit: sanitizeSearchLimit(request.limit, options?.maxLimit),
    mode,
    regexFlags,
    caseSensitive,
    includeHidden: request.includeHidden ?? false,
  };
};
