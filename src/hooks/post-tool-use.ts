import {
  hookPlatformSchema,
  postToolUseHookContextSchema,
  postToolUseHookPayloadSchema,
  postToolUseHookResultSchema,
  type PostToolUseHookContext,
  type PostToolUseHookPayload,
  type PostToolUseHookResult,
} from "./types.js";
import {
  HookAuditLogger,
  getDefaultHookAuditSink,
  hookAuditConfigSchema,
  type HookAuditSink,
  type HookAuditConfig,
} from "./audit.js";
import { HookPolicyEngine, type HookPolicyConfig } from "./policy.js";

export interface PostToolUseHookOptions {
  readonly now?: () => number;
}

export interface PostToolUseRuntimeOptions {
  readonly policy?: Partial<HookPolicyConfig>;
  readonly audit?: Partial<HookAuditConfig>;
  readonly auditSink?: HookAuditSink;
  readonly platform?: "neutral" | "claude" | "opencode";
  readonly telemetryRecorder?: {
    recordPostToolUse(input: {
      payload: PostToolUseHookPayload;
      result: PostToolUseHookResult;
      latencyMs: number;
      platform: "neutral" | "claude" | "opencode";
    }): void;
  };
  readonly selfLearningRecorder?: {
    recordFromPostToolUse(
      payload: PostToolUseHookPayload,
      result: PostToolUseHookResult,
    ): void;
  };
}

export class PostToolUseHook {
  private readonly now: () => number;

  constructor(options: PostToolUseHookOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    payload: PostToolUseHookPayload,
    context: Partial<PostToolUseHookContext> = {},
    runtime: PostToolUseRuntimeOptions = {},
  ): PostToolUseHookResult {
    const startedAt = Math.trunc(this.now());
    const validatedPayload = postToolUseHookPayloadSchema.parse(payload);
    const validatedContext = postToolUseHookContextSchema.parse({
      enabled: context.enabled,
      timestamp: context.timestamp ?? Math.trunc(this.now()),
      blockPatterns: context.blockPatterns,
    });
    const platform = hookPlatformSchema.parse(runtime.platform ?? "neutral");
    const policy = new HookPolicyEngine(runtime.policy ?? {});
    const auditConfig = hookAuditConfigSchema.parse(runtime.audit ?? {});
    const auditLogger = new HookAuditLogger(
      runtime.auditSink ?? getDefaultHookAuditSink(),
    );

    const withAudit = (
      result: PostToolUseHookResult,
    ): PostToolUseHookResult => {
      const finishedAt = Math.trunc(this.now());
      const latencyMs = Math.max(0, finishedAt - startedAt);
      auditLogger.log({
        hook: result.hook,
        sessionId: result.sessionId,
        platform,
        status: result.status,
        timestamp: result.timestamp,
        latencyMs,
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
        ...(result.reasonCode !== undefined
          ? { reasonCode: result.reasonCode }
          : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        payload: validatedPayload,
        context: validatedContext,
        config: auditConfig,
      });

      runtime.telemetryRecorder?.recordPostToolUse({
        payload: validatedPayload,
        result,
        latencyMs,
        platform,
      });
      runtime.selfLearningRecorder?.recordFromPostToolUse(
        validatedPayload,
        result,
      );

      return result;
    };

    if (!validatedContext.enabled) {
      return withAudit(
        postToolUseHookResultSchema.parse({
          hook: "post_tool_use",
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

    const decision = policy.evaluatePostToolUse(
      validatedPayload,
      validatedContext,
    );

    return withAudit(
      postToolUseHookResultSchema.parse({
        hook: "post_tool_use",
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
