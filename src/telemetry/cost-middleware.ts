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
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.003;

const tokenCostEventSchema = z.object({
  kind: z.literal("token_cost"),
  sessionId: z.string().trim().min(1).max(128),
  timestamp: z.number().int().nonnegative(),
  agentId: z.string().trim().min(1).max(64),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
});

const tokenCostSessionSummarySchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  events: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  byAgent: z.array(
    z.object({
      agentId: z.string().trim().min(1).max(64),
      runs: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      totalCostUsd: z.number().nonnegative(),
      averageDurationMs: z.number().nonnegative(),
    }),
  ),
});

export type TokenCostEvent = z.output<typeof tokenCostEventSchema>;
export type TokenCostSessionSummary = z.output<
  typeof tokenCostSessionSummarySchema
>;

export interface CostTrackingMiddlewareOptions {
  readonly telemetryRoot?: string;
  readonly now?: () => number;
  readonly costPer1kTokensUsd?: number;
}

export interface CostTrackingRecordInput {
  readonly sessionId: string;
  readonly agentId: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly durationMs: number;
  readonly retries?: number;
  readonly timestamp?: number;
}

export interface JsonlPruneInput {
  readonly maxAgeDays: number;
}

export interface JsonlPruneSummary {
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

const asDayKey = (unixMs: number): string =>
  new Date(unixMs).toISOString().slice(0, 10);

export class CostTrackingMiddleware {
  private readonly telemetryRoot: string;
  private readonly now: () => number;
  private readonly costPer1kTokensUsd: number;

  constructor(options: CostTrackingMiddlewareOptions = {}) {
    this.telemetryRoot = options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT;
    this.now = options.now ?? (() => Date.now());
    this.costPer1kTokensUsd =
      options.costPer1kTokensUsd ?? DEFAULT_COST_PER_1K_TOKENS_USD;
  }

  private sessionFilePath(sessionId: string): string {
    const safeSessionId = sanitizePathIdentifier(sessionId, {
      label: "session id",
      maxLength: 128,
    });

    return resolvePathWithinRoot(
      this.telemetryRoot,
      "tokens",
      "sessions",
      `${safeSessionId}.jsonl`,
    );
  }

  private dailyFilePath(timestamp: number): string {
    return join(
      this.telemetryRoot,
      "tokens",
      "daily",
      `${asDayKey(timestamp)}.jsonl`,
    );
  }

  private calculateCost(tokensIn: number, tokensOut: number): number {
    return ((tokensIn + tokensOut) / 1000) * this.costPer1kTokensUsd;
  }

  private pruneDir(
    dirPath: string,
    cutoffTimestamp: number,
  ): JsonlPruneSummary {
    if (!existsSync(dirPath)) {
      return {
        maxAgeDays: 0,
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
      const allEvents = readJsonl(filePath)
        .map((raw) => tokenCostEventSchema.safeParse(raw))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data);
      if (allEvents.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      const retainedEvents = allEvents.filter(
        (event) => event.timestamp >= cutoffTimestamp,
      );
      const deletedForFile = allEvents.length - retainedEvents.length;
      if (deletedForFile === 0) {
        continue;
      }

      recordsDeleted += deletedForFile;
      if (retainedEvents.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      writeFileSync(
        filePath,
        `${retainedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );
      filesRewritten += 1;
    }

    return {
      maxAgeDays: 0,
      cutoffTimestamp,
      filesDeleted,
      filesRewritten,
      recordsDeleted,
    };
  }

  recordAgentRunCost(input: CostTrackingRecordInput): TokenCostEvent {
    const timestamp = input.timestamp ?? Math.trunc(this.now());
    const tokensIn = Math.max(0, Math.trunc(input.tokensIn ?? 0));
    const tokensOut = Math.max(0, Math.trunc(input.tokensOut ?? 0));

    const event = tokenCostEventSchema.parse({
      kind: "token_cost",
      sessionId: input.sessionId,
      timestamp,
      agentId: input.agentId,
      tokensIn,
      tokensOut,
      totalTokens: tokensIn + tokensOut,
      costUsd: this.calculateCost(tokensIn, tokensOut),
      durationMs: Math.max(0, Math.trunc(input.durationMs)),
      retries: Math.max(0, Math.trunc(input.retries ?? 0)),
    });

    appendJsonl(this.sessionFilePath(event.sessionId), event);
    appendJsonl(this.dailyFilePath(event.timestamp), event);

    return event;
  }

  listSessionEvents(sessionId: string): TokenCostEvent[] {
    return readJsonl(this.sessionFilePath(sessionId))
      .map((raw) => tokenCostEventSchema.safeParse(raw))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
  }

  summarizeSession(sessionId: string): TokenCostSessionSummary {
    const events = this.listSessionEvents(sessionId);
    const perAgent = new Map<
      string,
      {
        runs: number;
        totalTokens: number;
        totalCostUsd: number;
        totalDuration: number;
      }
    >();

    for (const event of events) {
      const existing = perAgent.get(event.agentId) ?? {
        runs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalDuration: 0,
      };
      existing.runs += 1;
      existing.totalTokens += event.totalTokens;
      existing.totalCostUsd += event.costUsd;
      existing.totalDuration += event.durationMs;
      perAgent.set(event.agentId, existing);
    }

    const byAgent = Array.from(perAgent.entries())
      .map(([agentId, value]) => ({
        agentId,
        runs: value.runs,
        totalTokens: value.totalTokens,
        totalCostUsd: value.totalCostUsd,
        averageDurationMs:
          value.runs === 0 ? 0 : value.totalDuration / value.runs,
      }))
      .sort((left, right) => left.agentId.localeCompare(right.agentId));

    return tokenCostSessionSummarySchema.parse({
      sessionId,
      events: events.length,
      totalTokensIn: events.reduce((sum, event) => sum + event.tokensIn, 0),
      totalTokensOut: events.reduce((sum, event) => sum + event.tokensOut, 0),
      totalTokens: events.reduce((sum, event) => sum + event.totalTokens, 0),
      totalCostUsd: events.reduce((sum, event) => sum + event.costUsd, 0),
      byAgent,
    });
  }

  prune(input: JsonlPruneInput): JsonlPruneSummary {
    const maxAgeDays = Math.max(0, Math.trunc(input.maxAgeDays));
    const cutoffTimestamp = Math.trunc(this.now()) - maxAgeDays * 86_400_000;

    const sessions = this.pruneDir(
      join(this.telemetryRoot, "tokens", "sessions"),
      cutoffTimestamp,
    );
    const daily = this.pruneDir(
      join(this.telemetryRoot, "tokens", "daily"),
      cutoffTimestamp,
    );

    return {
      maxAgeDays,
      cutoffTimestamp,
      filesDeleted: sessions.filesDeleted + daily.filesDeleted,
      filesRewritten: sessions.filesRewritten + daily.filesRewritten,
      recordsDeleted: sessions.recordsDeleted + daily.recordsDeleted,
    };
  }
}
