import {
  hookPlatformSchema,
  notificationHookContextSchema,
  notificationHookPayloadSchema,
  notificationHookResultSchema,
  type NotificationHookContext,
  type NotificationHookPayload,
  type NotificationHookResult,
} from "./types.js";
import {
  HookAuditLogger,
  getDefaultHookAuditSink,
  hookAuditConfigSchema,
  type HookAuditSink,
  type HookAuditConfig,
} from "./audit.js";
import { HookPolicyEngine, type HookPolicyConfig } from "./policy.js";

export interface NotificationHookOptions {
  readonly now?: () => number;
}

export interface NotificationRuntimeOptions {
  readonly policy?: Partial<HookPolicyConfig>;
  readonly audit?: Partial<HookAuditConfig>;
  readonly auditSink?: HookAuditSink;
  readonly platform?: "neutral" | "claude" | "opencode";
}

export class NotificationHook {
  private readonly now: () => number;

  constructor(options: NotificationHookOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    payload: NotificationHookPayload,
    context: Partial<NotificationHookContext> = {},
    runtime: NotificationRuntimeOptions = {},
  ): NotificationHookResult {
    const startedAt = Math.trunc(this.now());
    const validatedPayload = notificationHookPayloadSchema.parse(payload);
    const validatedContext = notificationHookContextSchema.parse({
      enabled: context.enabled,
      timestamp: context.timestamp ?? Math.trunc(this.now()),
    });
    const platform = hookPlatformSchema.parse(runtime.platform ?? "neutral");
    const policy = new HookPolicyEngine(runtime.policy ?? {});
    const auditConfig = hookAuditConfigSchema.parse(runtime.audit ?? {});
    const auditLogger = new HookAuditLogger(
      runtime.auditSink ?? getDefaultHookAuditSink(),
    );

    const withAudit = (
      result: NotificationHookResult,
    ): NotificationHookResult => {
      const finishedAt = Math.trunc(this.now());
      auditLogger.log({
        hook: result.hook,
        sessionId: result.sessionId,
        platform,
        status: result.status,
        timestamp: result.timestamp,
        latencyMs: Math.max(0, finishedAt - startedAt),
        ...(result.reasonCode !== undefined
          ? { reasonCode: result.reasonCode }
          : {}),
        payload: validatedPayload,
        context: validatedContext,
        config: auditConfig,
      });

      return result;
    };

    if (!validatedContext.enabled) {
      return withAudit(
        notificationHookResultSchema.parse({
          hook: "notification",
          status: "skipped",
          sessionId: validatedPayload.sessionId,
          timestamp: validatedContext.timestamp,
          notificationType: validatedPayload.notificationType,
          message: validatedPayload.message,
          ...(validatedPayload.title !== undefined
            ? { title: validatedPayload.title }
            : {}),
          reasonCode: "hook_disabled",
        }),
      );
    }

    const notificationDecision = policy.evaluateNotification(validatedPayload);
    if (!notificationDecision.allow) {
      return withAudit(
        notificationHookResultSchema.parse({
          hook: "notification",
          status: "skipped",
          sessionId: validatedPayload.sessionId,
          timestamp: validatedContext.timestamp,
          notificationType: validatedPayload.notificationType,
          message: validatedPayload.message,
          ...(validatedPayload.title !== undefined
            ? { title: validatedPayload.title }
            : {}),
          ...(notificationDecision.reasonCode !== undefined
            ? { reasonCode: notificationDecision.reasonCode }
            : {}),
        }),
      );
    }

    return withAudit(
      notificationHookResultSchema.parse({
        hook: "notification",
        status: "executed",
        sessionId: validatedPayload.sessionId,
        timestamp: validatedContext.timestamp,
        notificationType: validatedPayload.notificationType,
        message: validatedPayload.message,
        ...(validatedPayload.title !== undefined
          ? { title: validatedPayload.title }
          : {}),
      }),
    );
  }
}
