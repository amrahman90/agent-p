import { appendFileSync } from "node:fs";

import { z } from "zod";

import {
  hookPlatformSchema,
  type HookName,
  type HookReasonCode,
} from "./types.js";

const MAX_REDACTED_PREVIEW = 2000;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const hookAuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  redactSensitive: z.boolean().default(true),
  maxPreviewChars: z.number().int().positive().default(MAX_REDACTED_PREVIEW),
});

export type HookAuditConfig = z.output<typeof hookAuditConfigSchema>;

export const hookAuditEventSchema = z.object({
  hook: z.custom<HookName>(),
  sessionId: z.string().trim().min(1),
  platform: hookPlatformSchema,
  status: z.enum(["executed", "skipped"]),
  timestamp: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  decision: z.string().trim().min(1).optional(),
  reasonCode: z.custom<HookReasonCode>().optional(),
  reason: z.string().trim().min(1).optional(),
  payloadPreview: z.string(),
  contextPreview: z.string(),
});

export type HookAuditEvent = z.output<typeof hookAuditEventSchema>;

export interface HookAuditSink {
  write(event: HookAuditEvent): void;
}

export class InMemoryHookAuditSink implements HookAuditSink {
  private readonly events: HookAuditEvent[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  write(event: HookAuditEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEntries) {
      this.events.splice(0, this.events.length - this.maxEntries);
    }
  }

  snapshot(): readonly HookAuditEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

export class JsonlHookAuditSink implements HookAuditSink {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  write(event: HookAuditEvent): void {
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie)/i;

const redactUnknown = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry));
  }

  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redactUnknown(nested);
    }

    return redacted;
  }

  return value;
};

const stringifyPreview = (value: unknown, maxChars: number): string => {
  const safeValue = jsonValueSchema.safeParse(value);
  const text = JSON.stringify(
    safeValue.success ? safeValue.data : { value: String(value) },
  );
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}...`;
};

export interface HookAuditLoggerLogInput {
  readonly hook: HookName;
  readonly sessionId: string;
  readonly platform: "neutral" | "claude" | "opencode";
  readonly status: "executed" | "skipped";
  readonly timestamp: number;
  readonly latencyMs: number;
  readonly decision?: string;
  readonly reasonCode?: HookReasonCode;
  readonly reason?: string;
  readonly payload: unknown;
  readonly context: unknown;
  readonly config: HookAuditConfig;
}

export class HookAuditLogger {
  private readonly sink: HookAuditSink;

  constructor(sink: HookAuditSink) {
    this.sink = sink;
  }

  log(input: HookAuditLoggerLogInput): void {
    if (!input.config.enabled) {
      return;
    }

    const payload = input.config.redactSensitive
      ? redactUnknown(input.payload)
      : input.payload;
    const context = input.config.redactSensitive
      ? redactUnknown(input.context)
      : input.context;

    const event = hookAuditEventSchema.parse({
      hook: input.hook,
      sessionId: input.sessionId,
      platform: input.platform,
      status: input.status,
      timestamp: input.timestamp,
      latencyMs: input.latencyMs,
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.reasonCode !== undefined
        ? { reasonCode: input.reasonCode }
        : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      payloadPreview: stringifyPreview(payload, input.config.maxPreviewChars),
      contextPreview: stringifyPreview(context, input.config.maxPreviewChars),
    });

    this.sink.write(event);
  }
}

const defaultHookAuditSink = new InMemoryHookAuditSink();

export const getDefaultHookAuditSink = (): InMemoryHookAuditSink =>
  defaultHookAuditSink;
