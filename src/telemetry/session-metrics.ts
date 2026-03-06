import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  resolvePathWithinRoot,
  sanitizePathIdentifier,
} from "../path-security.js";
import type {
  PostToolUseHookPayload,
  PostToolUseHookResult,
} from "../hooks/index.js";
import {
  telemetryEventSchema,
  telemetrySessionSummarySchema,
  type TelemetryAgentRunEvent,
  type TelemetryEvent,
  type TelemetryPostToolUseEvent,
  type TelemetrySearchRunEvent,
  type TelemetrySessionSummary,
} from "./types.js";
import { CostTrackingMiddleware } from "./cost-middleware.js";

const DEFAULT_TELEMETRY_ROOT = ".agent-p/telemetry";
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.003;

export interface SessionMetricsTrackerOptions {
  readonly telemetryRoot?: string;
  readonly now?: () => number;
  readonly costPer1kTokensUsd?: number;
  readonly costMiddleware?: CostTrackingMiddleware;
}

export interface PostToolUseTelemetryRecordInput {
  readonly payload: PostToolUseHookPayload;
  readonly result: PostToolUseHookResult;
  readonly latencyMs: number;
  readonly platform: "neutral" | "claude" | "opencode";
}

export interface AgentRunRecordInput {
  readonly sessionId: string;
  readonly agentId: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly retries?: number;
}

export interface SearchRunRecordInput {
  readonly sessionId: string;
  readonly query: string;
  readonly provider: string;
  readonly durationMs: number;
  readonly resultCount: number;
  readonly error?: string;
  readonly timestamp?: number;
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

export class SessionMetricsTracker {
  private readonly telemetryRoot: string;
  private readonly costMiddleware: CostTrackingMiddleware;
  private readonly now: () => number;

  constructor(options: SessionMetricsTrackerOptions = {}) {
    this.telemetryRoot = options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT;
    this.now = options.now ?? (() => Date.now());
    const costPer1kTokensUsd =
      options.costPer1kTokensUsd ?? DEFAULT_COST_PER_1K_TOKENS_USD;
    this.costMiddleware =
      options.costMiddleware ??
      new CostTrackingMiddleware({
        telemetryRoot: this.telemetryRoot,
        now: this.now,
        costPer1kTokensUsd,
      });
  }

  private sessionFilePath(sessionId: string): string {
    const safeSessionId = sanitizePathIdentifier(sessionId, {
      label: "session id",
      maxLength: 128,
    });

    return resolvePathWithinRoot(
      this.telemetryRoot,
      "sessions",
      `${safeSessionId}.jsonl`,
    );
  }

  private dailyMetricsFilePath(timestamp: number): string {
    return join(this.telemetryRoot, "metrics", `${asDayKey(timestamp)}.jsonl`);
  }

  recordPostToolUse(
    input: PostToolUseTelemetryRecordInput,
  ): TelemetryPostToolUseEvent {
    const event = telemetryEventSchema.parse({
      kind: "post_tool_use",
      sessionId: input.payload.sessionId,
      timestamp: input.result.timestamp,
      toolName: input.payload.toolName,
      status: input.result.status,
      ...(input.result.decision !== undefined
        ? { decision: input.result.decision }
        : {}),
      ...(input.result.reasonCode !== undefined
        ? { reasonCode: input.result.reasonCode }
        : {}),
      latencyMs: Math.max(0, Math.trunc(input.latencyMs)),
      platform: input.platform,
    }) as TelemetryPostToolUseEvent;

    appendJsonl(this.sessionFilePath(event.sessionId), event);
    appendJsonl(this.dailyMetricsFilePath(event.timestamp), event);

    return event;
  }

  recordAgentRun(input: AgentRunRecordInput): TelemetryAgentRunEvent {
    const tokenEvent = this.costMiddleware.recordAgentRunCost({
      sessionId: input.sessionId,
      agentId: input.agentId,
      durationMs: input.durationMs,
      ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
      ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
      ...(input.retries !== undefined ? { retries: input.retries } : {}),
    });

    const event = telemetryEventSchema.parse({
      kind: "agent_run",
      sessionId: input.sessionId,
      timestamp: tokenEvent.timestamp,
      agentId: input.agentId,
      success: input.success,
      durationMs: Math.max(0, Math.trunc(input.durationMs)),
      tokensIn: tokenEvent.tokensIn,
      tokensOut: tokenEvent.tokensOut,
      retries: input.retries ?? 0,
      costUsd: tokenEvent.costUsd,
    }) as TelemetryAgentRunEvent;

    appendJsonl(this.sessionFilePath(event.sessionId), event);
    appendJsonl(this.dailyMetricsFilePath(event.timestamp), event);

    return event;
  }

  recordSearchRun(input: SearchRunRecordInput): TelemetrySearchRunEvent {
    const event = telemetryEventSchema.parse({
      kind: "search_run",
      sessionId: input.sessionId,
      timestamp: input.timestamp ?? Math.trunc(this.now()),
      query: input.query,
      provider: input.provider,
      durationMs: Math.max(0, Math.trunc(input.durationMs)),
      resultCount: Math.max(0, Math.trunc(input.resultCount)),
      ...(input.error !== undefined && input.error.trim().length > 0
        ? { error: input.error }
        : {}),
    }) as TelemetrySearchRunEvent;

    appendJsonl(this.sessionFilePath(event.sessionId), event);
    appendJsonl(this.dailyMetricsFilePath(event.timestamp), event);

    return event;
  }

  listSessionEvents(sessionId: string): TelemetryEvent[] {
    return readJsonl(this.sessionFilePath(sessionId))
      .map((raw) => telemetryEventSchema.safeParse(raw))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
  }

  summarizeSession(sessionId: string): TelemetrySessionSummary {
    const events = this.listSessionEvents(sessionId);
    const postToolEvents = events.filter(
      (event): event is TelemetryPostToolUseEvent =>
        event.kind === "post_tool_use",
    );
    const agentEvents = events.filter(
      (event): event is TelemetryAgentRunEvent => event.kind === "agent_run",
    );

    const totalLatency = postToolEvents.reduce(
      (sum, event) => sum + event.latencyMs,
      0,
    );
    const averageLatencyMs =
      postToolEvents.length === 0 ? 0 : totalLatency / postToolEvents.length;

    return telemetrySessionSummarySchema.parse({
      sessionId,
      totalEvents: events.length,
      postToolUse: {
        total: postToolEvents.length,
        executed: postToolEvents.filter((event) => event.status === "executed")
          .length,
        skipped: postToolEvents.filter((event) => event.status === "skipped")
          .length,
        allowed: postToolEvents.filter((event) => event.decision === "allow")
          .length,
        blocked: postToolEvents.filter((event) => event.decision === "block")
          .length,
        averageLatencyMs,
      },
      agents: {
        totalRuns: agentEvents.length,
        successRuns: agentEvents.filter((event) => event.success).length,
        failedRuns: agentEvents.filter((event) => !event.success).length,
        totalTokensIn: agentEvents.reduce(
          (sum, event) => sum + event.tokensIn,
          0,
        ),
        totalTokensOut: agentEvents.reduce(
          (sum, event) => sum + event.tokensOut,
          0,
        ),
        totalCostUsd: agentEvents.reduce(
          (sum, event) => sum + event.costUsd,
          0,
        ),
      },
    });
  }
}
