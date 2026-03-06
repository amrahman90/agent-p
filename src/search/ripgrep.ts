import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

import { sanitizeSearchRequest } from "./sanitize.js";
import type {
  SanitizedSearchRequest,
  SearchHit,
  SearchRequest,
} from "./types.js";

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface RipgrepStageOptions {
  readonly workspaceRoot: string;
  readonly rgBinary?: string;
  readonly spawnProcess?: SpawnProcess;
  readonly maxQueryLength?: number;
  readonly maxLimit?: number;
}

interface RipgrepEvent {
  readonly type?: string;
  readonly data?: {
    readonly path?: {
      readonly text?: string;
    };
    readonly lines?: {
      readonly text?: string;
    };
    readonly line_number?: number;
    readonly submatches?: readonly {
      readonly start?: number;
    }[];
  };
}

const normalizePreview = (line: string | undefined): string => {
  return (line ?? "").replace(/[\r\n]+$/g, "");
};

export const parseRipgrepJsonLine = (line: string): SearchHit | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const event = JSON.parse(trimmed) as RipgrepEvent;
  if (event.type !== "match") {
    return undefined;
  }

  const filePath = event.data?.path?.text;
  if (!filePath) {
    return undefined;
  }

  const lineNumber = event.data?.line_number;
  const firstSubmatch = event.data?.submatches?.[0]?.start;

  return {
    filePath,
    line:
      Number.isInteger(lineNumber) && lineNumber && lineNumber > 0
        ? lineNumber
        : 1,
    column:
      Number.isInteger(firstSubmatch) && firstSubmatch !== undefined
        ? firstSubmatch + 1
        : 1,
    preview: normalizePreview(event.data?.lines?.text),
    score: 0,
  };
};

export const parseRipgrepJsonOutput = (stdout: string): SearchHit[] => {
  const matches: SearchHit[] = [];

  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }

    const match = parseRipgrepJsonLine(line);
    if (match) {
      matches.push(match);
    }
  }

  return matches;
};

/**
 * Builds a safe, explicit ripgrep argument list (no shell interpolation).
 */
export const buildRipgrepArgs = (
  request: SanitizedSearchRequest,
): readonly string[] => {
  const args: string[] = [
    "--json",
    "--line-number",
    "--column",
    "--color",
    "never",
    "--no-heading",
    "--with-filename",
    "--max-count",
    String(request.limit),
  ];

  if (request.mode === "literal") {
    args.push("--fixed-strings");
  }

  if (!request.caseSensitive || request.regexFlags.includes("i")) {
    args.push("-i");
  }

  if (request.mode === "regex") {
    if (request.regexFlags.includes("m")) {
      args.push("--multiline");
    }

    if (request.regexFlags.includes("s")) {
      args.push("--multiline-dotall");
    }
  }

  if (request.includeHidden) {
    args.push("--hidden");
  }

  args.push("-e", request.query, ".");

  return args;
};

export class RipgrepSearchStage {
  private readonly rgBinary: string;
  private readonly spawnProcess: SpawnProcess;

  constructor(private readonly options: RipgrepStageOptions) {
    this.rgBinary = options.rgBinary ?? "rg";
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnProcess);
  }

  /**
   * Executes Stage 1 search (ripgrep), returning normalized hits.
   */
  search(request: SearchRequest): Promise<SearchHit[]> {
    const sanitizeOptions: {
      maxLimit?: number;
      maxQueryLength?: number;
    } = {};

    if (this.options.maxLimit !== undefined) {
      sanitizeOptions.maxLimit = this.options.maxLimit;
    }

    if (this.options.maxQueryLength !== undefined) {
      sanitizeOptions.maxQueryLength = this.options.maxQueryLength;
    }

    const sanitized = sanitizeSearchRequest(
      request,
      this.options.workspaceRoot,
      sanitizeOptions,
    );

    return this.searchSanitized(sanitized);
  }

  /**
   * Executes Stage 1 search from an already sanitized request.
   */
  searchSanitized(sanitized: SanitizedSearchRequest): Promise<SearchHit[]> {
    const args = buildRipgrepArgs(sanitized);

    return new Promise((resolve, reject) => {
      const processHandle = this.spawnProcess(this.rgBinary, args, {
        cwd: sanitized.resolvedRoot,
      });

      let stdout = "";
      let stderr = "";

      processHandle.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      processHandle.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      processHandle.on("error", (error) => {
        reject(new Error(`failed to execute ripgrep: ${error.message}`));
      });

      processHandle.on("close", (code) => {
        if (code !== 0 && code !== 1) {
          const details = stderr.trim().length > 0 ? `: ${stderr.trim()}` : "";
          reject(new Error(`ripgrep exited with code ${code}${details}`));
          return;
        }

        try {
          const matches = parseRipgrepJsonOutput(stdout).slice(
            0,
            sanitized.limit,
          );
          resolve(matches);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          reject(new Error(`failed to parse ripgrep output: ${message}`));
        }
      });
    });
  }
}
