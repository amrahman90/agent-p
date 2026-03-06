import {
  hookPlatformSchema,
  sessionStartHookContextSchema,
  sessionStartHookPayloadSchema,
  sessionStartHookResultSchema,
  type SessionStartHookContext,
  type SessionStartHookPayload,
  type SessionStartHookResult,
} from "./types.js";
import {
  HookAuditLogger,
  getDefaultHookAuditSink,
  hookAuditConfigSchema,
  type HookAuditSink,
  type HookAuditConfig,
} from "./audit.js";

export interface SessionStartHookOptions {
  readonly now?: () => number;
}

export interface SessionStartRuntimeOptions {
  readonly audit?: Partial<HookAuditConfig>;
  readonly auditSink?: HookAuditSink;
  readonly platform?: "neutral" | "claude" | "opencode";
}

export class SessionStartHook {
  private readonly now: () => number;

  constructor(options: SessionStartHookOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    payload: SessionStartHookPayload,
    context: Partial<SessionStartHookContext> = {},
    runtime: SessionStartRuntimeOptions = {},
  ): SessionStartHookResult {
    const startedAt = Math.trunc(this.now());
    const validatedPayload = sessionStartHookPayloadSchema.parse(payload);
    const validatedContext = sessionStartHookContextSchema.parse({
      enabled: context.enabled,
      timestamp: context.timestamp ?? Math.trunc(this.now()),
    });
    const platform = hookPlatformSchema.parse(runtime.platform ?? "neutral");
    const auditConfig = hookAuditConfigSchema.parse(runtime.audit ?? {});
    const auditLogger = new HookAuditLogger(
      runtime.auditSink ?? getDefaultHookAuditSink(),
    );

    const withAudit = (
      result: SessionStartHookResult,
    ): SessionStartHookResult => {
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
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        payload: validatedPayload,
        context: validatedContext,
        config: auditConfig,
      });

      return result;
    };

    if (!validatedContext.enabled) {
      return withAudit(
        sessionStartHookResultSchema.parse({
          hook: "session_start",
          status: "skipped",
          sessionId: validatedPayload.sessionId,
          timestamp: validatedContext.timestamp,
          reason: "hook_disabled",
          reasonCode: "hook_disabled",
          ...(validatedPayload.query !== undefined
            ? { query: validatedPayload.query }
            : {}),
        }),
      );
    }

    return withAudit(
      sessionStartHookResultSchema.parse({
        hook: "session_start",
        status: "executed",
        sessionId: validatedPayload.sessionId,
        timestamp: validatedContext.timestamp,
        ...(validatedPayload.query !== undefined
          ? { query: validatedPayload.query }
          : {}),
      }),
    );
  }
}
