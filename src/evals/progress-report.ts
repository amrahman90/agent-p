import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  resolvePathWithinRoot,
  sanitizePathIdentifier,
} from "../path-security.js";

const DEFAULT_TELEMETRY_ROOT = ".agent-p/telemetry";

export const progressReportSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  timestamp: z.number().int().nonnegative(),
  agent: z.string().trim().min(1).max(64),
  status: z.enum(["idle", "running", "completed", "failed"]),
  progress: z.number().int().min(0).max(100),
  metrics: z.object({
    tokens: z.number().int().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
  }),
});

export type ProgressReport = z.output<typeof progressReportSchema>;

export interface ProgressReportPipelineOptions {
  readonly telemetryRoot?: string;
  readonly now?: () => number;
}

export interface ProgressReportRecordInput {
  readonly sessionId: string;
  readonly agent: string;
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly progress: number;
  readonly tokens?: number;
  readonly latencyMs?: number;
  readonly retries?: number;
  readonly timestamp?: number;
}

export interface ProgressReportPruneInput {
  readonly maxAgeDays: number;
}

export interface ProgressReportPruneSummary {
  readonly maxAgeDays: number;
  readonly cutoffTimestamp: number;
  readonly filesDeleted: number;
  readonly filesRewritten: number;
  readonly recordsDeleted: number;
}

const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

const appendJsonl = (filePath: string, value: unknown): void => {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
};

const readJsonl = (filePath: string): unknown[] => {
  if (!existsSync(filePath)) {
    return [];
  }

  const text = readFileSync(filePath, "utf8").trim();
  if (text.length === 0) {
    return [];
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is unknown => entry !== null);
};

export class ProgressReportPipeline {
  private readonly telemetryRoot: string;
  private readonly now: () => number;

  constructor(options: ProgressReportPipelineOptions = {}) {
    this.telemetryRoot = options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT;
    this.now = options.now ?? (() => Date.now());
  }

  private filePath(sessionId: string): string {
    const safeSessionId = sanitizePathIdentifier(sessionId, {
      label: "session id",
      maxLength: 128,
    });

    return resolvePathWithinRoot(
      this.telemetryRoot,
      "progress",
      `${safeSessionId}.jsonl`,
    );
  }

  record(input: ProgressReportRecordInput): ProgressReport {
    const report = progressReportSchema.parse({
      sessionId: input.sessionId,
      timestamp: input.timestamp ?? Math.trunc(this.now()),
      agent: input.agent,
      status: input.status,
      progress: Math.trunc(input.progress),
      metrics: {
        tokens: Math.max(0, Math.trunc(input.tokens ?? 0)),
        latency_ms: Math.max(0, Math.trunc(input.latencyMs ?? 0)),
        retries: Math.max(0, Math.trunc(input.retries ?? 0)),
      },
    });

    appendJsonl(this.filePath(report.sessionId), report);
    return report;
  }

  listSessionReports(sessionId: string): ProgressReport[] {
    return readJsonl(this.filePath(sessionId))
      .map((raw) => progressReportSchema.safeParse(raw))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
      .sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        return left.agent.localeCompare(right.agent);
      });
  }

  latestByAgent(sessionId: string): ProgressReport[] {
    const latest = new Map<string, ProgressReport>();

    for (const report of this.listSessionReports(sessionId)) {
      latest.set(report.agent, report);
    }

    return Array.from(latest.values()).sort((left, right) =>
      left.agent.localeCompare(right.agent),
    );
  }

  prune(input: ProgressReportPruneInput): ProgressReportPruneSummary {
    const maxAgeDays = Math.max(0, Math.trunc(input.maxAgeDays));
    const cutoffTimestamp = Math.trunc(this.now()) - maxAgeDays * 86_400_000;
    const dirPath = join(this.telemetryRoot, "progress");

    if (!existsSync(dirPath)) {
      return {
        maxAgeDays,
        cutoffTimestamp,
        filesDeleted: 0,
        filesRewritten: 0,
        recordsDeleted: 0,
      };
    }

    let filesDeleted = 0;
    let filesRewritten = 0;
    let recordsDeleted = 0;

    for (const entry of readdirSync(dirPath)) {
      if (!entry.endsWith(".jsonl")) {
        continue;
      }

      const filePath = join(dirPath, entry);
      const reports = readJsonl(filePath)
        .map((raw) => progressReportSchema.safeParse(raw))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data);
      if (reports.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      const retained = reports.filter(
        (report) => report.timestamp >= cutoffTimestamp,
      );
      const deletedForFile = reports.length - retained.length;
      if (deletedForFile === 0) {
        continue;
      }

      recordsDeleted += deletedForFile;
      if (retained.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      writeFileSync(
        filePath,
        `${retained.map((report) => JSON.stringify(report)).join("\n")}\n`,
        "utf8",
      );
      filesRewritten += 1;
    }

    return {
      maxAgeDays,
      cutoffTimestamp,
      filesDeleted,
      filesRewritten,
      recordsDeleted,
    };
  }
}
