import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  resolvePathWithinRoot,
  sanitizePathIdentifier,
} from "../path-security.js";

const DEFAULT_EVALS_ROOT = ".agent-p/evals";

const skillEffectivenessEventSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  sessionId: z.string().trim().min(1).max(128),
  skillName: z.string().trim().min(1).max(120),
  success: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});

const skillEffectivenessSummarySchema = z.object({
  skillName: z.string().trim().min(1).max(120),
  activations: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  avgTokens: z.number().nonnegative(),
});

export type SkillEffectivenessEvent = z.output<
  typeof skillEffectivenessEventSchema
>;
export type SkillEffectivenessSummary = z.output<
  typeof skillEffectivenessSummarySchema
>;

export interface SkillEffectivenessStoreOptions {
  readonly evalsRoot?: string;
  readonly now?: () => number;
}

export interface SkillEffectivenessRecordInput {
  readonly sessionId: string;
  readonly skillName: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly tokens?: number;
  readonly timestamp?: number;
}

export interface SkillEffectivenessPruneInput {
  readonly maxAgeDays: number;
}

export interface SkillEffectivenessPruneSummary {
  readonly maxAgeDays: number;
  readonly cutoffTimestamp: number;
  readonly filesDeleted: number;
  readonly filesRewritten: number;
  readonly recordsDeleted: number;
}

const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

const appendJsonl = (filePath: string, value: unknown): void => {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
};

const readJsonl = (filePath: string): unknown[] => {
  if (!existsSync(filePath)) {
    return [];
  }

  const text = readFileSync(filePath, "utf8").trim();
  if (text.length === 0) {
    return [];
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is unknown => entry !== null);
};

export class SkillEffectivenessStore {
  private readonly evalsRoot: string;
  private readonly now: () => number;

  constructor(options: SkillEffectivenessStoreOptions = {}) {
    this.evalsRoot = options.evalsRoot ?? DEFAULT_EVALS_ROOT;
    this.now = options.now ?? (() => Date.now());
  }

  private filePath(skillName: string): string {
    const safeSkillName = sanitizePathIdentifier(skillName, {
      label: "skill name",
      maxLength: 120,
    });

    return resolvePathWithinRoot(
      this.evalsRoot,
      "skills",
      `${safeSkillName}.jsonl`,
    );
  }

  recordActivation(
    input: SkillEffectivenessRecordInput,
  ): SkillEffectivenessEvent {
    const event = skillEffectivenessEventSchema.parse({
      timestamp: input.timestamp ?? Math.trunc(this.now()),
      sessionId: input.sessionId,
      skillName: input.skillName,
      success: input.success,
      latencyMs: Math.max(0, Math.trunc(input.latencyMs)),
      tokens: Math.max(0, Math.trunc(input.tokens ?? 0)),
    });

    appendJsonl(this.filePath(event.skillName), event);
    return event;
  }

  listSkillEvents(skillName: string): SkillEffectivenessEvent[] {
    return readJsonl(this.filePath(skillName))
      .map((raw) => skillEffectivenessEventSchema.safeParse(raw))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
  }

  summarizeSkill(skillName: string): SkillEffectivenessSummary {
    const events = this.listSkillEvents(skillName);
    const activations = events.length;
    const successes = events.filter((event) => event.success).length;
    const failures = activations - successes;

    return skillEffectivenessSummarySchema.parse({
      skillName,
      activations,
      successes,
      failures,
      successRate: activations === 0 ? 0 : successes / activations,
      avgLatencyMs:
        activations === 0
          ? 0
          : events.reduce((sum, event) => sum + event.latencyMs, 0) /
            activations,
      avgTokens:
        activations === 0
          ? 0
          : events.reduce((sum, event) => sum + event.tokens, 0) / activations,
    });
  }

  summarizeAllSkills(): SkillEffectivenessSummary[] {
    const skillsDir = join(this.evalsRoot, "skills");
    if (!existsSync(skillsDir)) {
      return [];
    }

    return readdirSync(skillsDir)
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => entry.slice(0, -6))
      .sort((left, right) => left.localeCompare(right))
      .map((skillName) => this.summarizeSkill(skillName));
  }

  prune(input: SkillEffectivenessPruneInput): SkillEffectivenessPruneSummary {
    const maxAgeDays = Math.max(0, Math.trunc(input.maxAgeDays));
    const cutoffTimestamp = Math.trunc(this.now()) - maxAgeDays * 86_400_000;
    const skillsDir = join(this.evalsRoot, "skills");

    if (!existsSync(skillsDir)) {
      return {
        maxAgeDays,
        cutoffTimestamp,
        filesDeleted: 0,
        filesRewritten: 0,
        recordsDeleted: 0,
      };
    }

    let filesDeleted = 0;
    let filesRewritten = 0;
    let recordsDeleted = 0;

    for (const entry of readdirSync(skillsDir)) {
      if (!entry.endsWith(".jsonl")) {
        continue;
      }

      const filePath = join(skillsDir, entry);
      const events = readJsonl(filePath)
        .map((raw) => skillEffectivenessEventSchema.safeParse(raw))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data);
      if (events.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      const retained = events.filter(
        (event) => event.timestamp >= cutoffTimestamp,
      );
      const deletedForFile = events.length - retained.length;
      if (deletedForFile === 0) {
        continue;
      }

      recordsDeleted += deletedForFile;
      if (retained.length === 0) {
        unlinkSync(filePath);
        filesDeleted += 1;
        continue;
      }

      writeFileSync(
        filePath,
        `${retained.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );
      filesRewritten += 1;
    }

    return {
      maxAgeDays,
      cutoffTimestamp,
      filesDeleted,
      filesRewritten,
      recordsDeleted,
    };
  }
}
