import {
  hookPlatformSchema,
  preToolUseHookContextSchema,
  preToolUseHookPayloadSchema,
  preToolUseHookResultSchema,
  type PreToolUseHookContext,
  type PreToolUseHookPayload,
  type PreToolUseHookResult,
} from "./types.js";
import {
  HookAuditLogger,
  getDefaultHookAuditSink,
  hookAuditConfigSchema,
  type HookAuditSink,
  type HookAuditConfig,
} from "./audit.js";
import { HookPolicyEngine, type HookPolicyConfig } from "./policy.js";

export interface PreToolUseHookOptions {
  readonly now?: () => number;
}

export interface PreToolUseRuntimeOptions {
  readonly policy?: Partial<HookPolicyConfig>;
  readonly audit?: Partial<HookAuditConfig>;
  readonly auditSink?: HookAuditSink;
  readonly platform?: "neutral" | "claude" | "opencode";
}

export class PreToolUseHook {
  private readonly now: () => number;

  constructor(options: PreToolUseHookOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    payload: PreToolUseHookPayload,
    context: Partial<PreToolUseHookContext> = {},
    runtime: PreToolUseRuntimeOptions = {},
  ): PreToolUseHookResult {
    const startedAt = Math.trunc(this.now());
    const validatedPayload = preToolUseHookPayloadSchema.parse(payload);
    const validatedContext = preToolUseHookContextSchema.parse({
      enabled: context.enabled,
      timestamp: context.timestamp ?? Math.trunc(this.now()),
      mode: context.mode,
      blockedPatterns: context.blockedPatterns,
    });
    const platform = hookPlatformSchema.parse(runtime.platform ?? "neutral");
    const policy = new HookPolicyEngine(runtime.policy ?? {});
    const auditConfig = hookAuditConfigSchema.parse(runtime.audit ?? {});
    const auditLogger = new HookAuditLogger(
      runtime.auditSink ?? getDefaultHookAuditSink(),
    );

    const withAudit = (result: PreToolUseHookResult): PreToolUseHookResult => {
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
        preToolUseHookResultSchema.parse({
          hook: "pre_tool_use",
          status: "skipped",
          sessionId: validatedPayload.sessionId,
          timestamp: validatedContext.timestamp,
          toolName: validatedPayload.toolName,
          reason: "hook_disabled",
          reasonCode: "hook_disabled",
          ...(validatedPayload.toolUseId !== undefined
            ? { toolUseId: validatedPayload.toolUseId }
            : {}),
        }),
      );
    }

    const decision = policy.evaluatePreToolUse(
      validatedPayload,
      validatedContext,
    );

    return withAudit(
      preToolUseHookResultSchema.parse({
        hook: "pre_tool_use",
        status: "executed",
        sessionId: validatedPayload.sessionId,
        timestamp: validatedContext.timestamp,
        toolName: validatedPayload.toolName,
        decision: decision.decision,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        ...(decision.reasonCode !== undefined
          ? { reasonCode: decision.reasonCode }
          : {}),
        ...(decision.contextAdditions !== undefined
          ? { contextAdditions: decision.contextAdditions }
          : {}),
        ...(validatedPayload.toolUseId !== undefined
          ? { toolUseId: validatedPayload.toolUseId }
          : {}),
      }),
    );
  }
}
