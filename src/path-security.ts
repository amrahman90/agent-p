import { resolve, sep } from "node:path";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const normalizeForComparison = (value: string): string => {
  return process.platform === "win32" ? value.toLowerCase() : value;
};

const isWithinRoot = (rootPath: string, candidatePath: string): boolean => {
  const normalizedRoot = normalizeForComparison(rootPath);
  const normalizedCandidate = normalizeForComparison(candidatePath);

  if (normalizedRoot === normalizedCandidate) {
    return true;
  }

  return normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
};

export const sanitizePathIdentifier = (
  value: string,
  options?: {
    readonly label?: string;
    readonly maxLength?: number;
  },
): string => {
  const label = options?.label ?? "identifier";
  const maxLength = options?.maxLength ?? 128;
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  if (normalized.includes("\0")) {
    throw new Error(`${label} contains invalid null byte`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} exceeds max length of ${maxLength}`);
  }

  if (
    normalized === "." ||
    normalized === ".." ||
    !SAFE_IDENTIFIER_PATTERN.test(normalized)
  ) {
    throw new Error(
      `${label} may only contain letters, numbers, '.', '-', '_'`,
    );
  }

  return normalized;
};

export const resolvePathWithinRoot = (
  rootPath: string,
  ...relativeSegments: readonly string[]
): string => {
  if (rootPath.includes("\0")) {
    throw new Error("root path contains invalid null byte");
  }

  for (const segment of relativeSegments) {
    if (segment.includes("\0")) {
      throw new Error("path segment contains invalid null byte");
    }
  }

  const resolvedRoot = resolve(rootPath);
  const resolvedCandidate = resolve(resolvedRoot, ...relativeSegments);

  if (!isWithinRoot(resolvedRoot, resolvedCandidate)) {
    throw new Error("resolved path escapes configured root");
  }

  return resolvedCandidate;
};
