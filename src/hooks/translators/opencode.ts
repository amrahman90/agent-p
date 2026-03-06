import { z } from "zod";

import {
  notificationHookPayloadSchema,
  postToolUseHookPayloadSchema,
  preToolUseHookPayloadSchema,
  sessionStartHookPayloadSchema,
  stopHookPayloadSchema,
  type NotificationHookPayload,
  type NotificationHookResult,
  type PostToolUseHookPayload,
  type PostToolUseHookResult,
  type PreToolUseHookPayload,
  type PreToolUseHookResult,
  type SessionStartHookPayload,
  type SessionStartHookResult,
  type StopHookPayload,
  type StopHookResult,
} from "../types.js";

export const openCodeEventNameSchema = z.enum([
  "session.created",
  "tool.execute.before",
  "tool.execute.after",
  "session.idle",
  "tui.toast.show",
]);

const openCodeBaseSchema = z.object({
  sessionId: z.string().trim().min(1),
});

const openCodeSessionCreatedSchema = openCodeBaseSchema.extend({
  query: z.string().trim().min(1).optional(),
});

const openCodeBeforeToolSchema = openCodeBaseSchema.extend({
  tool: z.object({
    name: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()),
    id: z.string().trim().min(1).optional(),
  }),
});

const openCodeAfterToolSchema = openCodeBaseSchema.extend({
  tool: z.object({
    name: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()),
    output: z.unknown().optional(),
    id: z.string().trim().min(1).optional(),
  }),
});

const openCodeSessionIdleSchema = openCodeBaseSchema.extend({
  stopHookActive: z.boolean().optional(),
  lastMessage: z.string().trim().min(1).optional(),
});

const openCodeToastSchema = openCodeBaseSchema.extend({
  type: z.string().trim().min(1),
  message: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
});

export const fromOpenCodeSessionCreatedEvent = (
  payload: unknown,
): SessionStartHookPayload => {
  const parsed = openCodeSessionCreatedSchema.parse(payload);
  return sessionStartHookPayloadSchema.parse({
    sessionId: parsed.sessionId,
    ...(parsed.query !== undefined ? { query: parsed.query } : {}),
  });
};

export const fromOpenCodeToolBeforeEvent = (
  payload: unknown,
): PreToolUseHookPayload => {
  const parsed = openCodeBeforeToolSchema.parse(payload);
  return preToolUseHookPayloadSchema.parse({
    sessionId: parsed.sessionId,
    toolName: parsed.tool.name,
    toolInput: parsed.tool.input,
    ...(parsed.tool.id !== undefined ? { toolUseId: parsed.tool.id } : {}),
  });
};

export const fromOpenCodeToolAfterEvent = (
  payload: unknown,
): PostToolUseHookPayload => {
  const parsed = openCodeAfterToolSchema.parse(payload);
  return postToolUseHookPayloadSchema.parse({
    sessionId: parsed.sessionId,
    toolName: parsed.tool.name,
    toolInput: parsed.tool.input,
    ...(parsed.tool.output !== undefined
      ? { toolResponse: parsed.tool.output }
      : {}),
    ...(parsed.tool.id !== undefined ? { toolUseId: parsed.tool.id } : {}),
  });
};

export const fromOpenCodeSessionIdleEvent = (
  payload: unknown,
): StopHookPayload => {
  const parsed = openCodeSessionIdleSchema.parse(payload);
  return stopHookPayloadSchema.parse({
    sessionId: parsed.sessionId,
    stopHookActive: parsed.stopHookActive ?? false,
    ...(parsed.lastMessage !== undefined
      ? { lastAssistantMessage: parsed.lastMessage }
      : {}),
  });
};

export const fromOpenCodeToastEvent = (
  payload: unknown,
): NotificationHookPayload => {
  const parsed = openCodeToastSchema.parse(payload);
  return notificationHookPayloadSchema.parse({
    sessionId: parsed.sessionId,
    notificationType: parsed.type,
    message: parsed.message,
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
  });
};

export const toOpenCodeSessionStartOutput = (
  result: SessionStartHookResult,
): Record<string, unknown> => ({
  allow: result.status === "executed",
  ...(result.query !== undefined ? { context: result.query } : {}),
});

export const toOpenCodePreToolUseOutput = (
  result: PreToolUseHookResult,
): Record<string, unknown> => ({
  action:
    result.decision === "deny"
      ? "deny"
      : result.decision === "escalate"
        ? "ask"
        : "allow",
  ...(result.reason !== undefined ? { reason: result.reason } : {}),
  ...(result.inputPatch !== undefined
    ? { updatedInput: result.inputPatch }
    : {}),
  ...(result.contextAdditions !== undefined
    ? { additionalContext: result.contextAdditions }
    : {}),
});

export const toOpenCodePostToolUseOutput = (
  result: PostToolUseHookResult,
): Record<string, unknown> => ({
  action: result.decision === "block" ? "block" : "allow",
  ...(result.reason !== undefined ? { reason: result.reason } : {}),
  ...(result.contextAdditions !== undefined
    ? { additionalContext: result.contextAdditions }
    : {}),
});

export const toOpenCodeStopOutput = (
  result: StopHookResult,
): Record<string, unknown> => ({
  continue: result.decision === "block",
  ...(result.reason !== undefined ? { stopReason: result.reason } : {}),
});

export const toOpenCodeNotificationOutput = (
  result: NotificationHookResult,
): Record<string, unknown> => ({
  observed: result.status === "executed",
  type: result.notificationType,
});
