import { z } from "zod";

const sessionIdSchema = z.string().trim().min(1).max(128);

export const telemetryPostToolUseEventSchema = z.object({
  kind: z.literal("post_tool_use"),
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  toolName: z.string().trim().min(1).max(80),
  status: z.enum(["executed", "skipped"]),
  decision: z.enum(["allow", "block"]).optional(),
  reasonCode: z.string().trim().min(1).max(80).optional(),
  latencyMs: z.number().int().nonnegative(),
  platform: z.enum(["neutral", "claude", "opencode"]),
});

export const telemetryAgentRunEventSchema = z.object({
  kind: z.literal("agent_run"),
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  agentId: z.string().trim().min(1).max(64),
  success: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  retries: z.number().int().nonnegative().default(0),
  costUsd: z.number().min(0),
});

export const telemetrySearchRunEventSchema = z.object({
  kind: z.literal("search_run"),
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  query: z.string().trim().min(1).max(1000),
  provider: z.string().trim().min(1).max(80),
  durationMs: z.number().int().nonnegative(),
  resultCount: z.number().int().nonnegative(),
  error: z.string().trim().min(1).max(500).optional(),
});

export const telemetryEventSchema = z.discriminatedUnion("kind", [
  telemetryPostToolUseEventSchema,
  telemetryAgentRunEventSchema,
  telemetrySearchRunEventSchema,
]);

export const telemetrySessionSummarySchema = z.object({
  sessionId: sessionIdSchema,
  totalEvents: z.number().int().nonnegative(),
  postToolUse: z.object({
    total: z.number().int().nonnegative(),
    executed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    allowed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    averageLatencyMs: z.number().nonnegative(),
  }),
  agents: z.object({
    totalRuns: z.number().int().nonnegative(),
    successRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
    totalTokensIn: z.number().int().nonnegative(),
    totalTokensOut: z.number().int().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
  }),
});

export type TelemetryPostToolUseEvent = z.output<
  typeof telemetryPostToolUseEventSchema
>;
export type TelemetryAgentRunEvent = z.output<
  typeof telemetryAgentRunEventSchema
>;
export type TelemetrySearchRunEvent = z.output<
  typeof telemetrySearchRunEventSchema
>;
export type TelemetryEvent = z.output<typeof telemetryEventSchema>;
export type TelemetrySessionSummary = z.output<
  typeof telemetrySessionSummarySchema
>;
