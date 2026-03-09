import { z } from "zod";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_QUERY_LENGTH = 500;
const MAX_REASON_LENGTH = 200;
const MAX_CONTEXT_LENGTH = 500;
const MAX_TOOL_NAME_LENGTH = 80;
const MAX_NOTIFICATION_TYPE_LENGTH = 80;
const MAX_TOOL_USE_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_PATTERN_COUNT = 20;
const MAX_PATTERN_LENGTH = 120;

const sessionIdSchema = z
  .string()
  .min(1)
  .max(MAX_SESSION_ID_LENGTH)
  .regex(/^[a-zA-Z0-9._:-]+$/);

const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TOOL_NAME_LENGTH)
  .regex(/^[a-zA-Z0-9._:-]+$/);

const toolUseIdSchema = z.string().trim().min(1).max(MAX_TOOL_USE_ID_LENGTH);

const jsonObjectSchema = z.record(z.string(), z.unknown());

const querySchema = z.string().trim().min(1).max(MAX_QUERY_LENGTH);

/**
 * Available hook names in the system.
 * @example
 * ```typescript
 * const hookName: HookName = "pre_tool_use";
 * ```
 */
export const hookNameSchema = z.enum([
  "session_start",
  "pre_tool_use",
  "post_tool_use",
  "stop",
  "notification",
]);

export const hookExecutionStatusSchema = z.enum(["executed", "skipped"]);

export const hookReasonCodeSchema = z.enum([
  "hook_disabled",
  "policy_block",
  "validation_failed",
  "no_action",
]);

export const hookPlatformSchema = z.enum(["neutral", "claude", "opencode"]);

export const preToolUseHookModeSchema = z.enum(["enforce", "dry-run"]);
export const preToolUsePermissionDecisionSchema = z.enum([
  "allow",
  "deny",
  "escalate",
]);
export const postToolUseDecisionSchema = z.enum(["allow", "block"]);
export const stopHookDecisionSchema = z.enum(["allow", "block"]);

export const sessionStartHookPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  query: querySchema.optional(),
});

export const sessionStartHookContextSchema = z.object({
  enabled: z.boolean().default(true),
  timestamp: z.number().int().nonnegative(),
});

export const sessionStartHookResultSchema = z.object({
  hook: z.literal("session_start"),
  status: hookExecutionStatusSchema,
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  reason: z.string().min(1).max(MAX_REASON_LENGTH).optional(),
  reasonCode: hookReasonCodeSchema.optional(),
  query: querySchema.optional(),
});

export const preToolUseHookPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  toolName: toolNameSchema,
  toolInput: jsonObjectSchema,
  toolUseId: toolUseIdSchema.optional(),
});

export const preToolUseHookContextSchema = z.object({
  enabled: z.boolean().default(true),
  timestamp: z.number().int().nonnegative(),
  mode: preToolUseHookModeSchema.default("enforce"),
  blockedPatterns: z
    .array(z.string().trim().min(1).max(MAX_PATTERN_LENGTH))
    .max(MAX_PATTERN_COUNT)
    .default([]),
});

export const preToolUseHookResultSchema = z.object({
  hook: z.literal("pre_tool_use"),
  status: hookExecutionStatusSchema,
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  toolName: toolNameSchema,
  decision: preToolUsePermissionDecisionSchema.optional(),
  reason: z.string().min(1).max(MAX_REASON_LENGTH).optional(),
  reasonCode: hookReasonCodeSchema.optional(),
  inputPatch: jsonObjectSchema.optional(),
  contextAdditions: z.string().trim().min(1).max(MAX_CONTEXT_LENGTH).optional(),
  toolUseId: toolUseIdSchema.optional(),
});

export const postToolUseHookPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  toolName: toolNameSchema,
  toolInput: jsonObjectSchema,
  toolResponse: z.unknown().optional(),
  toolUseId: toolUseIdSchema.optional(),
});

export const postToolUseHookContextSchema = z.object({
  enabled: z.boolean().default(true),
  timestamp: z.number().int().nonnegative(),
  blockPatterns: z
    .array(z.string().trim().min(1).max(MAX_PATTERN_LENGTH))
    .max(MAX_PATTERN_COUNT)
    .default([]),
});

export const postToolUseHookResultSchema = z.object({
  hook: z.literal("post_tool_use"),
  status: hookExecutionStatusSchema,
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  toolName: toolNameSchema,
  decision: postToolUseDecisionSchema.optional(),
  reason: z.string().min(1).max(MAX_REASON_LENGTH).optional(),
  reasonCode: hookReasonCodeSchema.optional(),
  contextAdditions: z.string().trim().min(1).max(MAX_CONTEXT_LENGTH).optional(),
  toolUseId: toolUseIdSchema.optional(),
});

export const stopHookPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  stopHookActive: z.boolean().default(false),
  lastAssistantMessage: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .optional(),
});

export const stopHookContextSchema = z.object({
  enabled: z.boolean().default(true),
  timestamp: z.number().int().nonnegative(),
  completionSignal: z.string().trim().min(1).max(MAX_PATTERN_LENGTH).optional(),
});

export const stopHookResultSchema = z.object({
  hook: z.literal("stop"),
  status: hookExecutionStatusSchema,
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  stopHookActive: z.boolean(),
  decision: stopHookDecisionSchema.optional(),
  reason: z.string().min(1).max(MAX_REASON_LENGTH).optional(),
  reasonCode: hookReasonCodeSchema.optional(),
  contextAdditions: z.string().trim().min(1).max(MAX_CONTEXT_LENGTH).optional(),
});

export const notificationHookPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  notificationType: z.string().trim().min(1).max(MAX_NOTIFICATION_TYPE_LENGTH),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  title: z.string().trim().min(1).max(MAX_REASON_LENGTH).optional(),
});

export const notificationHookContextSchema = z.object({
  enabled: z.boolean().default(true),
  timestamp: z.number().int().nonnegative(),
});

export const notificationHookResultSchema = z.object({
  hook: z.literal("notification"),
  status: hookExecutionStatusSchema,
  sessionId: sessionIdSchema,
  timestamp: z.number().int().nonnegative(),
  notificationType: z.string().trim().min(1).max(MAX_NOTIFICATION_TYPE_LENGTH),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  title: z.string().trim().min(1).max(MAX_REASON_LENGTH).optional(),
  reasonCode: hookReasonCodeSchema.optional(),
});

export type HookName = z.infer<typeof hookNameSchema>;
export type HookExecutionStatus = z.infer<typeof hookExecutionStatusSchema>;
export type HookReasonCode = z.infer<typeof hookReasonCodeSchema>;
export type HookPlatform = z.infer<typeof hookPlatformSchema>;
export type SessionStartHookPayload = z.infer<
  typeof sessionStartHookPayloadSchema
>;
export type SessionStartHookContext = z.infer<
  typeof sessionStartHookContextSchema
>;
export type SessionStartHookResult = z.infer<
  typeof sessionStartHookResultSchema
>;
export type PreToolUseHookMode = z.infer<typeof preToolUseHookModeSchema>;
export type PreToolUsePermissionDecision = z.infer<
  typeof preToolUsePermissionDecisionSchema
>;
export type PreToolUseHookPayload = z.infer<typeof preToolUseHookPayloadSchema>;
export type PreToolUseHookContext = z.infer<typeof preToolUseHookContextSchema>;
export type PreToolUseHookResult = z.infer<typeof preToolUseHookResultSchema>;
export type PostToolUseDecision = z.infer<typeof postToolUseDecisionSchema>;
export type PostToolUseHookPayload = z.infer<
  typeof postToolUseHookPayloadSchema
>;
export type PostToolUseHookContext = z.infer<
  typeof postToolUseHookContextSchema
>;
export type PostToolUseHookResult = z.infer<typeof postToolUseHookResultSchema>;
export type StopHookDecision = z.infer<typeof stopHookDecisionSchema>;
export type StopHookPayload = z.infer<typeof stopHookPayloadSchema>;
export type StopHookContext = z.infer<typeof stopHookContextSchema>;
export type StopHookResult = z.infer<typeof stopHookResultSchema>;
export type NotificationHookPayload = z.infer<
  typeof notificationHookPayloadSchema
>;
export type NotificationHookContext = z.infer<
  typeof notificationHookContextSchema
>;
export type NotificationHookResult = z.infer<
  typeof notificationHookResultSchema
>;
