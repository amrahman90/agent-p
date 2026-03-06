import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import type {
  PostToolUseHookPayload,
  PostToolUseHookResult,
} from "../hooks/index.js";

const selfLearningPatternSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  sessionId: z.string().trim().min(1).max(128),
  toolName: z.string().trim().min(1).max(80),
  outcome: z.enum(["success", "blocked", "skipped"]),
  decision: z.enum(["allow", "block"]).optional(),
  reasonCode: z.string().trim().min(1).max(80).optional(),
  inputKeys: z.array(z.string().trim().min(1).max(120)),
});

export type SelfLearningPattern = z.output<typeof selfLearningPatternSchema>;

export interface SelfLearningPatternStoreOptions {
  readonly telemetryRoot?: string;
}

const DEFAULT_TELEMETRY_ROOT = ".agent-p/telemetry";

const dayKey = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

export class SelfLearningPatternStore {
  private readonly telemetryRoot: string;

  constructor(options: SelfLearningPatternStoreOptions = {}) {
    this.telemetryRoot = options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT;
  }

  private filePath(timestamp: number): string {
    return join(this.telemetryRoot, "patterns", `${dayKey(timestamp)}.jsonl`);
  }

  recordFromPostToolUse(
    payload: PostToolUseHookPayload,
    result: PostToolUseHookResult,
  ): SelfLearningPattern {
    const outcome: "success" | "blocked" | "skipped" =
      result.status === "skipped"
        ? "skipped"
        : result.decision === "block"
          ? "blocked"
          : "success";

    const pattern = selfLearningPatternSchema.parse({
      timestamp: result.timestamp,
      sessionId: payload.sessionId,
      toolName: payload.toolName,
      outcome,
      ...(result.decision !== undefined ? { decision: result.decision } : {}),
      ...(result.reasonCode !== undefined
        ? { reasonCode: result.reasonCode }
        : {}),
      inputKeys: Object.keys(payload.toolInput).sort((left, right) =>
        left.localeCompare(right),
      ),
    });

    const filePath = this.filePath(pattern.timestamp);
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(pattern)}\n`, "utf8");

    return pattern;
  }
}
