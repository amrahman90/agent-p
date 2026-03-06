import { z } from "zod";

import {
  postToolUseDecisionSchema,
  preToolUsePermissionDecisionSchema,
  stopHookDecisionSchema,
  type HookReasonCode,
  type NotificationHookPayload,
  type PostToolUseHookContext,
  type PostToolUseHookPayload,
  type PreToolUseHookContext,
  type PreToolUseHookPayload,
  type StopHookContext,
  type StopHookPayload,
} from "./types.js";

const MAX_PATTERN_COUNT = 20;
const MAX_PATTERN_LENGTH = 120;

type ToolCategory =
  | "shell"
  | "filesystem"
  | "network"
  | "orchestration"
  | "memory"
  | "database"
  | "unknown";

export const hookPolicyProfileSchema = z.enum([
  "strict",
  "balanced",
  "permissive",
]);

const TOOL_CATEGORY_BY_NAME: Record<string, ToolCategory> = {
  bash: "shell",
  read: "filesystem",
  write: "filesystem",
  edit: "filesystem",
  glob: "filesystem",
  grep: "filesystem",
  webfetch: "network",
  websearch: "network",
  codesearch: "network",
  task: "orchestration",
  question: "orchestration",
  todowrite: "orchestration",
  "db:check": "database",
  memory: "memory",
};

const patternListSchema = z
  .array(z.string().trim().min(1).max(MAX_PATTERN_LENGTH))
  .max(MAX_PATTERN_COUNT);

const hookPolicyScopeOverrideSchema = z.object({
  strictMode: z.boolean().optional(),
  escalationThreshold: z.number().min(0).max(1).optional(),
  risky: z.boolean().optional(),
  sensitivePatterns: patternListSchema.optional(),
  preToolUseDefaultDecision: preToolUsePermissionDecisionSchema.optional(),
  postToolUseDefaultDecision: postToolUseDecisionSchema.optional(),
  stopDefaultDecision: stopHookDecisionSchema.optional(),
});

type HookPolicyScopeOverride = z.output<typeof hookPolicyScopeOverrideSchema>;

interface HookPolicyProfileDefaults {
  readonly strictMode: boolean;
  readonly escalationThreshold: number;
  readonly riskyTools: readonly string[];
  readonly sensitivePatterns: readonly string[];
  readonly preToolUseDefaultDecision: "allow" | "deny" | "escalate";
  readonly postToolUseDefaultDecision: "allow" | "block";
  readonly stopDefaultDecision: "allow" | "block";
}

const policyProfileDefaults: Record<
  z.output<typeof hookPolicyProfileSchema>,
  HookPolicyProfileDefaults
> = {
  strict: {
    strictMode: true,
    escalationThreshold: 0.5,
    riskyTools: ["bash", "write", "webfetch", "task"],
    sensitivePatterns: ["api_key", "token", "password", "secret"],
    preToolUseDefaultDecision: "escalate",
    postToolUseDefaultDecision: "allow",
    stopDefaultDecision: "allow",
  },
  balanced: {
    strictMode: false,
    escalationThreshold: 0.7,
    riskyTools: ["bash", "write", "webfetch"],
    sensitivePatterns: ["api_key", "token", "password", "secret"],
    preToolUseDefaultDecision: "allow",
    postToolUseDefaultDecision: "allow",
    stopDefaultDecision: "allow",
  },
  permissive: {
    strictMode: false,
    escalationThreshold: 1,
    riskyTools: [],
    sensitivePatterns: ["api_key", "token", "password", "secret"],
    preToolUseDefaultDecision: "allow",
    postToolUseDefaultDecision: "allow",
    stopDefaultDecision: "allow",
  },
};

export const hookPolicyConfigSchema = z
  .object({
    profile: hookPolicyProfileSchema.default("balanced"),
    strictMode: z.boolean().optional(),
    escalationThreshold: z.number().min(0).max(1).optional(),
    riskyTools: patternListSchema.optional(),
    sensitivePatterns: patternListSchema.optional(),
    preToolUseDefaultDecision: preToolUsePermissionDecisionSchema.optional(),
    postToolUseDefaultDecision: postToolUseDecisionSchema.optional(),
    stopDefaultDecision: stopHookDecisionSchema.optional(),
    categoryOverrides: z
      .record(z.string().trim().min(1), hookPolicyScopeOverrideSchema)
      .default({}),
    toolOverrides: z
      .record(z.string().trim().min(1), hookPolicyScopeOverrideSchema)
      .default({}),
  })
  .transform((input) => {
    const defaults = policyProfileDefaults[input.profile];

    return {
      profile: input.profile,
      strictMode: input.strictMode ?? defaults.strictMode,
      escalationThreshold:
        input.escalationThreshold ?? defaults.escalationThreshold,
      riskyTools: input.riskyTools ?? defaults.riskyTools,
      sensitivePatterns: input.sensitivePatterns ?? defaults.sensitivePatterns,
      preToolUseDefaultDecision:
        input.preToolUseDefaultDecision ?? defaults.preToolUseDefaultDecision,
      postToolUseDefaultDecision:
        input.postToolUseDefaultDecision ?? defaults.postToolUseDefaultDecision,
      stopDefaultDecision:
        input.stopDefaultDecision ?? defaults.stopDefaultDecision,
      categoryOverrides: input.categoryOverrides,
      toolOverrides: input.toolOverrides,
    };
  });

export type HookPolicyConfig = z.output<typeof hookPolicyConfigSchema>;

interface PolicyDecision<TDecision extends string> {
  readonly decision: TDecision;
  readonly reason?: string;
  readonly reasonCode?: HookReasonCode;
  readonly contextAdditions?: string;
}

interface NotificationPolicyDecision {
  readonly allow: boolean;
  readonly reasonCode?: HookReasonCode;
}

const findPatternMatch = (
  searchable: string,
  patterns: readonly string[],
): string | undefined => {
  const lowered = searchable.toLowerCase();
  for (const pattern of patterns) {
    if (lowered.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }

  return undefined;
};

const toSearchableInput = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
};

const matchesRiskyTool = (
  toolName: string,
  riskyTools: readonly string[],
): boolean =>
  riskyTools.some(
    (riskyTool) => riskyTool.toLowerCase() === toolName.toLowerCase(),
  );

export class HookPolicyEngine {
  private readonly config: HookPolicyConfig;
  private readonly normalizedToolOverrides: Record<
    string,
    HookPolicyScopeOverride
  >;
  private readonly normalizedCategoryOverrides: Record<
    string,
    HookPolicyScopeOverride
  >;

  constructor(config: Partial<HookPolicyConfig> = {}) {
    this.config = hookPolicyConfigSchema.parse(config);
    this.normalizedToolOverrides = Object.fromEntries(
      Object.entries(this.config.toolOverrides).map(([toolName, override]) => [
        toolName.trim().toLowerCase(),
        override,
      ]),
    );
    this.normalizedCategoryOverrides = Object.fromEntries(
      Object.entries(this.config.categoryOverrides).map(
        ([category, override]) => [category.trim().toLowerCase(), override],
      ),
    );
  }

  private resolveToolCategory(toolName: string): ToolCategory {
    return TOOL_CATEGORY_BY_NAME[toolName.trim().toLowerCase()] ?? "unknown";
  }

  private applyOverride(
    target: Omit<HookPolicyConfig, "toolOverrides" | "categoryOverrides">,
    override: HookPolicyScopeOverride | undefined,
  ): Omit<HookPolicyConfig, "toolOverrides" | "categoryOverrides"> {
    if (override === undefined) {
      return target;
    }

    return {
      ...target,
      ...(override.strictMode !== undefined
        ? { strictMode: override.strictMode }
        : {}),
      ...(override.escalationThreshold !== undefined
        ? { escalationThreshold: override.escalationThreshold }
        : {}),
      ...(override.sensitivePatterns !== undefined
        ? { sensitivePatterns: override.sensitivePatterns }
        : {}),
      ...(override.preToolUseDefaultDecision !== undefined
        ? { preToolUseDefaultDecision: override.preToolUseDefaultDecision }
        : {}),
      ...(override.postToolUseDefaultDecision !== undefined
        ? { postToolUseDefaultDecision: override.postToolUseDefaultDecision }
        : {}),
      ...(override.stopDefaultDecision !== undefined
        ? { stopDefaultDecision: override.stopDefaultDecision }
        : {}),
    };
  }

  private resolveScopedPolicy(toolName: string): {
    readonly policy: Omit<
      HookPolicyConfig,
      "toolOverrides" | "categoryOverrides"
    >;
    readonly riskyOverride?: boolean;
  } {
    const basePolicy = {
      profile: this.config.profile,
      strictMode: this.config.strictMode,
      escalationThreshold: this.config.escalationThreshold,
      riskyTools: this.config.riskyTools,
      sensitivePatterns: this.config.sensitivePatterns,
      preToolUseDefaultDecision: this.config.preToolUseDefaultDecision,
      postToolUseDefaultDecision: this.config.postToolUseDefaultDecision,
      stopDefaultDecision: this.config.stopDefaultDecision,
    };
    const category = this.resolveToolCategory(toolName);
    const categoryOverride =
      category === "unknown"
        ? undefined
        : this.normalizedCategoryOverrides[category];
    const toolOverride =
      this.normalizedToolOverrides[toolName.trim().toLowerCase()];

    const withCategory = this.applyOverride(basePolicy, categoryOverride);
    const withTool = this.applyOverride(withCategory, toolOverride);

    const riskyOverride = toolOverride?.risky ?? categoryOverride?.risky;

    return {
      policy: withTool,
      ...(riskyOverride !== undefined ? { riskyOverride } : {}),
    };
  }

  evaluatePreToolUse(
    payload: PreToolUseHookPayload,
    context: PreToolUseHookContext,
  ): PolicyDecision<"allow" | "deny" | "escalate"> {
    const scoped = this.resolveScopedPolicy(payload.toolName);
    const searchable = `${payload.toolName}\n${toSearchableInput(payload.toolInput)}`;
    const blockedPattern = findPatternMatch(
      searchable,
      context.blockedPatterns,
    );

    if (blockedPattern !== undefined && context.mode === "enforce") {
      return {
        decision: "deny",
        reason: `Blocked by policy pattern: ${blockedPattern}`,
        reasonCode: "policy_block",
      };
    }

    if (blockedPattern !== undefined) {
      return {
        decision: "allow",
        reasonCode: "no_action",
        contextAdditions: `Dry-run: would block due to pattern '${blockedPattern}'.`,
      };
    }

    const sensitivePattern = findPatternMatch(
      searchable,
      scoped.policy.sensitivePatterns,
    );
    const riskyToolMatch =
      scoped.riskyOverride ??
      matchesRiskyTool(payload.toolName, scoped.policy.riskyTools);
    const riskSignals =
      Number(riskyToolMatch) + Number(sensitivePattern !== undefined);
    const riskScore = riskSignals / 2;

    if (
      scoped.policy.strictMode &&
      riskScore >= scoped.policy.escalationThreshold &&
      context.mode === "enforce"
    ) {
      return {
        decision: "escalate",
        reason:
          sensitivePattern !== undefined
            ? `Escalated by strict policy due to sensitive pattern '${sensitivePattern}'.`
            : `Escalated by strict policy for risky tool '${payload.toolName}'.`,
        reasonCode: "policy_block",
      };
    }

    if (
      scoped.policy.strictMode &&
      riskScore >= scoped.policy.escalationThreshold &&
      context.mode === "dry-run"
    ) {
      return {
        decision: "allow",
        reasonCode: "no_action",
        contextAdditions:
          "Dry-run: strict policy would escalate this tool use for manual approval.",
      };
    }

    return {
      decision: scoped.policy.preToolUseDefaultDecision,
      ...(scoped.policy.preToolUseDefaultDecision === "allow"
        ? {}
        : {
            reason: "Applied configured default pre-tool policy decision",
            reasonCode: "no_action" as const,
          }),
    };
  }

  evaluatePostToolUse(
    payload: PostToolUseHookPayload,
    context: PostToolUseHookContext,
  ): PolicyDecision<"allow" | "block"> {
    const scoped = this.resolveScopedPolicy(payload.toolName);
    const responseText = toSearchableInput(payload.toolResponse);
    const blockingPattern = findPatternMatch(
      responseText,
      context.blockPatterns,
    );

    if (blockingPattern !== undefined) {
      return {
        decision: "block",
        reason: `Post-tool policy blocked response pattern: ${blockingPattern}`,
        reasonCode: "policy_block",
      };
    }

    if (scoped.policy.strictMode) {
      const sensitivePattern = findPatternMatch(
        responseText,
        scoped.policy.sensitivePatterns,
      );
      if (sensitivePattern !== undefined) {
        return {
          decision: "block",
          reason: `Strict policy blocked sensitive response pattern: ${sensitivePattern}`,
          reasonCode: "policy_block",
        };
      }
    }

    if (scoped.policy.postToolUseDefaultDecision === "block") {
      return {
        decision: "block",
        reason: "Blocked by configured default post-tool policy decision",
        reasonCode: "policy_block",
      };
    }

    return { decision: "allow" };
  }

  evaluateStop(
    payload: StopHookPayload,
    context: StopHookContext,
  ): PolicyDecision<"allow" | "block"> {
    if (payload.stopHookActive) {
      return { decision: "allow" };
    }

    if (context.completionSignal !== undefined) {
      const hasSignal =
        payload.lastAssistantMessage
          ?.toLowerCase()
          .includes(context.completionSignal.toLowerCase()) ?? false;
      if (!hasSignal) {
        return {
          decision: "block",
          reason: "Completion signal missing from assistant output",
          reasonCode: "policy_block",
          contextAdditions:
            "Continue and produce a complete final answer before stopping.",
        };
      }
    }

    if (this.config.stopDefaultDecision === "block") {
      return {
        decision: "block",
        reason: "Blocked by configured default stop policy decision",
        reasonCode: "policy_block",
      };
    }

    return { decision: "allow" };
  }

  evaluateNotification(
    payload: NotificationHookPayload,
  ): NotificationPolicyDecision {
    if (!this.config.strictMode) {
      return { allow: true };
    }

    const searchable = `${payload.notificationType}\n${payload.message}`;
    const sensitivePattern = findPatternMatch(
      searchable,
      this.config.sensitivePatterns,
    );

    if (sensitivePattern !== undefined) {
      return {
        allow: false,
        reasonCode: "policy_block",
      };
    }

    return { allow: true };
  }
}
