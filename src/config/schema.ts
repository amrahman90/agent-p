import { z } from "zod";

import {
  hookAuditConfigSchema,
  hookPolicyConfigSchema,
} from "../hooks/index.js";

const governanceDefaults = {
  max_entries: 100,
  warn_entries: 150,
  hard_limit: 200,
} as const;

const shelfLifeDefaults = {
  tactical: 14,
  observational: 30,
} as const;

const treesitterDefaults = {
  mode: "optional",
  threshold: 20,
  timeout_ms: 500,
} as const;

const bm25Defaults = {
  enabled: true,
  k1: 1.5,
  b: 0.75,
} as const;

const jaccardDefaults = {
  enabled: true,
  threshold: 0.1,
} as const;

const workflowDefaults = {
  default: "dynamic",
  static_override: true,
  quick_threshold: 3,
} as const;

const hotDefaults = {
  maxSize: 10 * 1024 * 1024,
  ttlMs: 5 * 60 * 1000,
  maxEntries: 1000,
} as const;

const warmDefaults = {
  maxEntries: 10000,
  vacuumInterval: 24 * 60 * 60 * 1000,
} as const;

const coldDefaults = {
  maxAgeDays: 30,
  archivePath: ".agent-p/archives",
} as const;

const hooksDefaults = {
  enabled: true,
  preToolUse: true,
  postToolUse: true,
  sessionStart: true,
  stop: true,
  notification: true,
  policy: hookPolicyConfigSchema.parse({}),
  audit: hookAuditConfigSchema.parse({}),
} as const;

const telemetryDefaults = {
  enabled: true,
  traceErrors: true,
  sampleRate: 1,
} as const;

const agentDefaults = {
  enabled: true,
  maxRetries: 2,
  timeoutMs: 30000,
} as const;

const agentsDefaults = {
  expert: { ...agentDefaults, maxRetries: 3 },
  scout: { ...agentDefaults, timeoutMs: 15000 },
  builder: { ...agentDefaults },
  tester: { ...agentDefaults },
  reviewer: { ...agentDefaults, maxRetries: 1, timeoutMs: 15000 },
  verifier: { ...agentDefaults, timeoutMs: 20000 },
} as const;

const governanceSchema = z
  .object({
    max_entries: z
      .number()
      .int()
      .positive()
      .default(governanceDefaults.max_entries),
    warn_entries: z
      .number()
      .int()
      .positive()
      .default(governanceDefaults.warn_entries),
    hard_limit: z
      .number()
      .int()
      .positive()
      .default(governanceDefaults.hard_limit),
  })
  .default(governanceDefaults);

const shelfLifeSchema = z
  .object({
    tactical: z.number().int().positive().default(shelfLifeDefaults.tactical),
    observational: z
      .number()
      .int()
      .positive()
      .default(shelfLifeDefaults.observational),
  })
  .default(shelfLifeDefaults);

const expertiseSchema = z
  .object({
    governance: governanceSchema,
    shelf_life: shelfLifeSchema,
  })
  .default({ governance: governanceDefaults, shelf_life: shelfLifeDefaults });

const treesitterSchema = z
  .object({
    mode: z
      .enum(["required", "optional", "disabled"])
      .default(treesitterDefaults.mode),
    threshold: z
      .number()
      .int()
      .nonnegative()
      .default(treesitterDefaults.threshold),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .default(treesitterDefaults.timeout_ms),
  })
  .default(treesitterDefaults);

const bm25Schema = z
  .object({
    enabled: z.boolean().default(bm25Defaults.enabled),
    k1: z.number().positive().default(bm25Defaults.k1),
    b: z.number().positive().default(bm25Defaults.b),
  })
  .default(bm25Defaults);

const jaccardSchema = z
  .object({
    enabled: z.boolean().default(jaccardDefaults.enabled),
    threshold: z.number().min(0).max(1).default(jaccardDefaults.threshold),
  })
  .default(jaccardDefaults);

const searchSchema = z
  .object({
    stages: z
      .object({
        treesitter: treesitterSchema,
        bm25: bm25Schema,
        jaccard: jaccardSchema,
      })
      .default({
        treesitter: treesitterDefaults,
        bm25: bm25Defaults,
        jaccard: jaccardDefaults,
      }),
  })
  .default({
    stages: {
      treesitter: treesitterDefaults,
      bm25: bm25Defaults,
      jaccard: jaccardDefaults,
    },
  });

const workflowSchema = z
  .object({
    default: z
      .enum(["static", "dynamic", "quick"])
      .default(workflowDefaults.default),
    static_override: z.boolean().default(workflowDefaults.static_override),
    quick_threshold: z
      .number()
      .int()
      .positive()
      .default(workflowDefaults.quick_threshold),
  })
  .default(workflowDefaults);

const memorySchema = z
  .object({
    hot: z
      .object({
        maxSize: z.number().int().positive().default(hotDefaults.maxSize),
        ttlMs: z.number().int().positive().default(hotDefaults.ttlMs),
        maxEntries: z.number().int().positive().default(hotDefaults.maxEntries),
      })
      .default(hotDefaults),
    warm: z
      .object({
        maxEntries: z
          .number()
          .int()
          .positive()
          .default(warmDefaults.maxEntries),
        vacuumInterval: z
          .number()
          .int()
          .positive()
          .default(warmDefaults.vacuumInterval),
      })
      .default(warmDefaults),
    cold: z
      .object({
        maxAgeDays: z
          .number()
          .int()
          .positive()
          .default(coldDefaults.maxAgeDays),
        archivePath: z.string().min(1).default(coldDefaults.archivePath),
      })
      .default(coldDefaults),
  })
  .default({ hot: hotDefaults, warm: warmDefaults, cold: coldDefaults });

const hooksSchema = z
  .object({
    enabled: z.boolean().default(hooksDefaults.enabled),
    preToolUse: z.boolean().default(hooksDefaults.preToolUse),
    postToolUse: z.boolean().default(hooksDefaults.postToolUse),
    sessionStart: z.boolean().default(hooksDefaults.sessionStart),
    stop: z.boolean().default(hooksDefaults.stop),
    notification: z.boolean().default(hooksDefaults.notification),
    policy: hookPolicyConfigSchema.default(hooksDefaults.policy),
    audit: hookAuditConfigSchema.default(hooksDefaults.audit),
  })
  .default(hooksDefaults)
  .superRefine((hooks, issue) => {
    if (!hooks.enabled && hooks.policy.strictMode) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy", "strictMode"],
        message: "hooks.policy.strictMode requires hooks.enabled=true",
      });
    }

    if (
      hooks.policy.strictMode &&
      hooks.policy.preToolUseDefaultDecision === "allow"
    ) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy", "preToolUseDefaultDecision"],
        message:
          "hooks.policy.preToolUseDefaultDecision cannot be 'allow' when strictMode=true",
      });
    }

    if (hooks.audit.maxPreviewChars < 200) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audit", "maxPreviewChars"],
        message: "hooks.audit.maxPreviewChars must be >= 200",
      });
    }
  });

const telemetrySchema = z
  .object({
    enabled: z.boolean().default(telemetryDefaults.enabled),
    traceErrors: z.boolean().default(telemetryDefaults.traceErrors),
    sampleRate: z.number().min(0).max(1).default(telemetryDefaults.sampleRate),
  })
  .default(telemetryDefaults);

const agentUnitSchema = z
  .object({
    enabled: z.boolean().default(agentDefaults.enabled),
    maxRetries: z
      .number()
      .int()
      .nonnegative()
      .default(agentDefaults.maxRetries),
    timeoutMs: z.number().int().positive().default(agentDefaults.timeoutMs),
  })
  .default(agentDefaults);

export const agentPConfigSchema = z.object({
  version: z.string().default("0.0.1"),
  expertise: expertiseSchema,
  search: searchSchema,
  workflow: workflowSchema,
  memory: memorySchema,
  hooks: hooksSchema,
  telemetry: telemetrySchema,
  agents: z
    .object({
      expert: agentUnitSchema.default(agentsDefaults.expert),
      scout: agentUnitSchema.default(agentsDefaults.scout),
      builder: agentUnitSchema.default(agentsDefaults.builder),
      tester: agentUnitSchema.default(agentsDefaults.tester),
      reviewer: agentUnitSchema.default(agentsDefaults.reviewer),
      verifier: agentUnitSchema.default(agentsDefaults.verifier),
    })
    .default(agentsDefaults),
});

export type AgentPConfig = z.output<typeof agentPConfigSchema>;
