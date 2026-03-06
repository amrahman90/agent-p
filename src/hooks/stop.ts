import {
  hookPlatformSchema,
  stopHookContextSchema,
  stopHookPayloadSchema,
  stopHookResultSchema,
  type StopHookContext,
  type StopHookPayload,
  type StopHookResult,
} from "./types.js";
import {
  HookAuditLogger,
  getDefaultHookAuditSink,
  hookAuditConfigSchema,
  type HookAuditSink,
  type HookAuditConfig,
} from "./audit.js";
import { HookPolicyEngine, type HookPolicyConfig } from "./policy.js";

export interface StopHookOptions {
  readonly now?: () => number;
}

export interface StopRuntimeOptions {
  readonly policy?: Partial<HookPolicyConfig>;
  readonly audit?: Partial<HookAuditConfig>;
  readonly auditSink?: HookAuditSink;
  readonly platform?: "neutral" | "claude" | "opencode";
}

export class StopHook {
  private readonly now: () => number;

  constructor(options: StopHookOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    payload: StopHookPayload,
    context: Partial<StopHookContext> = {},
    runtime: StopRuntimeOptions = {},
  ): StopHookResult {
    const startedAt = Math.trunc(this.now());
    const validatedPayload = stopHookPayloadSchema.parse(payload);
    const validatedContext = stopHookContextSchema.parse({
      enabled: context.enabled,
      timestamp: context.timestamp ?? Math.trunc(this.now()),
      completionSignal: context.completionSignal,
    });
    const platform = hookPlatformSchema.parse(runtime.platform ?? "neutral");
    const policy = new HookPolicyEngine(runtime.policy ?? {});
    const auditConfig = hookAuditConfigSchema.parse(runtime.audit ?? {});
    const auditLogger = new HookAuditLogger(
      runtime.auditSink ?? getDefaultHookAuditSink(),
    );

    const withAudit = (result: StopHookResult): StopHookResult => {
      const finishedAt = Math.trunc(this.now());
      auditLogger.log({
        hook: result.hook,
        sessionId: result.sessionId,
        platform,
        status: result.status,
        timestamp: result.timestamp,
        latencyMs: Math.max(0, finishedAt - startedAt),
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
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
        stopHookResultSchema.parse({
          hook: "stop",
          status: "skipped",
          sessionId: validatedPayload.sessionId,
          timestamp: validatedContext.timestamp,
          stopHookActive: validatedPayload.stopHookActive,
          reason: "hook_disabled",
          reasonCode: "hook_disabled",
        }),
      );
    }

    const decision = policy.evaluateStop(validatedPayload, validatedContext);

    return withAudit(
      stopHookResultSchema.parse({
        hook: "stop",
        status: "executed",
        sessionId: validatedPayload.sessionId,
        timestamp: validatedContext.timestamp,
        stopHookActive: validatedPayload.stopHookActive,
        decision: decision.decision,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        ...(decision.reasonCode !== undefined
          ? { reasonCode: decision.reasonCode }
          : {}),
        ...(decision.contextAdditions !== undefined
          ? { contextAdditions: decision.contextAdditions }
          : {}),
      }),
    );
  }
}
