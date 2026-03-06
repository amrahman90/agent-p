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

const claudeBaseSchema = z.object({
  session_id: z.string().trim().min(1),
});

const claudeSessionStartSchema = claudeBaseSchema.extend({
  prompt: z.string().trim().min(1).optional(),
});

const claudePreToolUseSchema = claudeBaseSchema.extend({
  tool_name: z.string().trim().min(1),
  tool_input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string().trim().min(1).optional(),
});

const claudePostToolUseSchema = claudeBaseSchema.extend({
  tool_name: z.string().trim().min(1),
  tool_input: z.record(z.string(), z.unknown()),
  tool_response: z.unknown().optional(),
  tool_use_id: z.string().trim().min(1).optional(),
});

const claudeStopSchema = claudeBaseSchema.extend({
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().trim().min(1).optional(),
});

const claudeNotificationSchema = claudeBaseSchema.extend({
  notification_type: z.string().trim().min(1),
  message: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
});

export const fromClaudeSessionStartInput = (
  input: unknown,
): SessionStartHookPayload => {
  const parsed = claudeSessionStartSchema.parse(input);
  return sessionStartHookPayloadSchema.parse({
    sessionId: parsed.session_id,
    ...(parsed.prompt !== undefined ? { query: parsed.prompt } : {}),
  });
};

export const fromClaudePreToolUseInput = (
  input: unknown,
): PreToolUseHookPayload => {
  const parsed = claudePreToolUseSchema.parse(input);
  return preToolUseHookPayloadSchema.parse({
    sessionId: parsed.session_id,
    toolName: parsed.tool_name,
    toolInput: parsed.tool_input,
    ...(parsed.tool_use_id !== undefined
      ? { toolUseId: parsed.tool_use_id }
      : {}),
  });
};

export const fromClaudePostToolUseInput = (
  input: unknown,
): PostToolUseHookPayload => {
  const parsed = claudePostToolUseSchema.parse(input);
  return postToolUseHookPayloadSchema.parse({
    sessionId: parsed.session_id,
    toolName: parsed.tool_name,
    toolInput: parsed.tool_input,
    ...(parsed.tool_response !== undefined
      ? { toolResponse: parsed.tool_response }
      : {}),
    ...(parsed.tool_use_id !== undefined
      ? { toolUseId: parsed.tool_use_id }
      : {}),
  });
};

export const fromClaudeStopInput = (input: unknown): StopHookPayload => {
  const parsed = claudeStopSchema.parse(input);
  return stopHookPayloadSchema.parse({
    sessionId: parsed.session_id,
    stopHookActive: parsed.stop_hook_active ?? false,
    ...(parsed.last_assistant_message !== undefined
      ? { lastAssistantMessage: parsed.last_assistant_message }
      : {}),
  });
};

export const fromClaudeNotificationInput = (
  input: unknown,
): NotificationHookPayload => {
  const parsed = claudeNotificationSchema.parse(input);
  return notificationHookPayloadSchema.parse({
    sessionId: parsed.session_id,
    notificationType: parsed.notification_type,
    message: parsed.message,
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
  });
};

export const toClaudeSessionStartOutput = (
  result: SessionStartHookResult,
): Record<string, unknown> => ({
  ...(result.query !== undefined
    ? {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: result.query,
        },
      }
    : {}),
});

export const toClaudePreToolUseOutput = (
  result: PreToolUseHookResult,
): Record<string, unknown> => {
  if (result.status === "skipped") {
    return {};
  }

  const permissionDecision =
    result.decision === "escalate" ? "ask" : (result.decision ?? "allow");

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(result.reason !== undefined
        ? { permissionDecisionReason: result.reason }
        : {}),
      ...(result.inputPatch !== undefined
        ? { updatedInput: result.inputPatch }
        : {}),
      ...(result.contextAdditions !== undefined
        ? { additionalContext: result.contextAdditions }
        : {}),
    },
  };
};

export const toClaudePostToolUseOutput = (
  result: PostToolUseHookResult,
): Record<string, unknown> => ({
  ...(result.decision === "block"
    ? {
        decision: "block",
        reason: result.reason ?? "Blocked by post-tool hook policy",
      }
    : {}),
  ...(result.contextAdditions !== undefined
    ? {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: result.contextAdditions,
        },
      }
    : {}),
});

export const toClaudeStopOutput = (
  result: StopHookResult,
): Record<string, unknown> => ({
  ...(result.decision === "block"
    ? {
        decision: "block",
        reason: result.reason ?? "Blocked by stop hook policy",
      }
    : {}),
});

export const toClaudeNotificationOutput = (
  result: NotificationHookResult,
): Record<string, unknown> => ({
  ...(result.status === "executed"
    ? {
        hookSpecificOutput: {
          hookEventName: "Notification",
          additionalContext: `Observed notification: ${result.notificationType}`,
        },
      }
    : {}),
});
