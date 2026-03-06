import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  d3WorkflowCheckpointSchema,
  type D3WorkflowCheckpoint,
  type D3WorkflowPlan,
} from "./types.js";

const DEFAULT_WORKFLOW_ROOT = ".agent-p/workflow";

export interface D3WorkflowCheckpointStore {
  load(sessionId: string): D3WorkflowCheckpoint | undefined;
  loadReusable?(plan: D3WorkflowPlan): D3WorkflowCheckpoint | undefined;
  save(checkpoint: D3WorkflowCheckpoint): void;
}

export interface FileD3WorkflowCheckpointStoreOptions {
  readonly workflowRoot?: string;
  readonly planningArtifactRetentionLimit?: number;
}

const toCheckpointFileName = (sessionId: string): string => {
  const safeSession = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeSession}.json`;
};

interface PlanningArtifactIndexEntry {
  readonly cacheKey: string;
  readonly sessionId: string;
  readonly updatedAt: number;
}

interface PlanningArtifactIndexFile {
  readonly version: 1;
  readonly entries: readonly PlanningArtifactIndexEntry[];
}

const toPlanPhaseSignature = (plan: D3WorkflowPlan): string =>
  plan.phases
    .map(
      (phasePlan) => `${phasePlan.order}:${phasePlan.phase}:${phasePlan.stage}`,
    )
    .join("|");

const toPlanningArtifactCacheKey = (plan: D3WorkflowPlan): string =>
  JSON.stringify({
    query: plan.query,
    workflowMode: plan.workflowMode,
    effectiveWorkflowMode: plan.effectiveWorkflowMode,
    analysisMode: plan.analysisMode,
    complexity: plan.complexity,
    phaseSignature: toPlanPhaseSignature(plan),
    skippedPhases: plan.skippedPhases,
  });

const DEFAULT_PLANNING_ARTIFACT_RETENTION_LIMIT = 200;

export class FileD3WorkflowCheckpointStore implements D3WorkflowCheckpointStore {
  private readonly workflowRoot: string;

  private readonly planningArtifactRetentionLimit: number;

  constructor(options: FileD3WorkflowCheckpointStoreOptions = {}) {
    this.workflowRoot = options.workflowRoot ?? DEFAULT_WORKFLOW_ROOT;
    this.planningArtifactRetentionLimit = Math.max(
      options.planningArtifactRetentionLimit ??
        DEFAULT_PLANNING_ARTIFACT_RETENTION_LIMIT,
      1,
    );
  }

  load(sessionId: string): D3WorkflowCheckpoint | undefined {
    const path = this.filePath(sessionId);
    if (!existsSync(path)) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      return undefined;
    }

    const validated = d3WorkflowCheckpointSchema.safeParse(parsed);
    if (!validated.success) {
      return undefined;
    }

    return validated.data as D3WorkflowCheckpoint;
  }

  loadReusable(plan: D3WorkflowPlan): D3WorkflowCheckpoint | undefined {
    const index = this.readPlanningArtifactIndex();
    const cacheKey = toPlanningArtifactCacheKey(plan);
    const matches = index.entries
      .filter((entry) => entry.cacheKey === cacheKey)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (matches.length === 0) {
      return undefined;
    }

    const staleSessionIds = new Set<string>();
    for (const match of matches) {
      const checkpoint = this.load(match.sessionId);
      if (!checkpoint) {
        staleSessionIds.add(match.sessionId);
        continue;
      }

      if (toPlanningArtifactCacheKey(checkpoint.plan) !== cacheKey) {
        staleSessionIds.add(match.sessionId);
        continue;
      }

      if (staleSessionIds.size > 0) {
        this.writePlanningArtifactIndex({
          version: 1,
          entries: this.normalizePlanningArtifactEntries(
            index.entries.filter(
              (entry) =>
                entry.cacheKey !== cacheKey ||
                !staleSessionIds.has(entry.sessionId),
            ),
          ),
        });
      }

      return checkpoint;
    }

    this.writePlanningArtifactIndex({
      version: 1,
      entries: this.normalizePlanningArtifactEntries(
        index.entries.filter(
          (entry) =>
            entry.cacheKey !== cacheKey ||
            !staleSessionIds.has(entry.sessionId),
        ),
      ),
    });

    return undefined;
  }

  save(checkpoint: D3WorkflowCheckpoint): void {
    d3WorkflowCheckpointSchema.parse(checkpoint);

    const path = this.filePath(checkpoint.sessionId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

    const index = this.readPlanningArtifactIndex();
    const cacheKey = toPlanningArtifactCacheKey(checkpoint.plan);
    const nextEntries = [
      {
        cacheKey,
        sessionId: checkpoint.sessionId,
        updatedAt: checkpoint.updatedAt,
      },
      ...index.entries.filter((entry) => entry.cacheKey !== cacheKey),
    ];
    this.writePlanningArtifactIndex({
      version: 1,
      entries: this.normalizePlanningArtifactEntries(nextEntries),
    });
  }

  private filePath(sessionId: string): string {
    return join(
      this.workflowRoot,
      "checkpoints",
      toCheckpointFileName(sessionId),
    );
  }

  private planningArtifactIndexPath(): string {
    return join(this.workflowRoot, "planning-artifacts", "index.json");
  }

  private readPlanningArtifactIndex(): PlanningArtifactIndexFile {
    const path = this.planningArtifactIndexPath();
    if (!existsSync(path)) {
      return { version: 1, entries: [] };
    }

    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        return { version: 1, entries: [] };
      }

      const entries = Array.isArray((parsed as { entries?: unknown }).entries)
        ? ((parsed as { entries: unknown[] }).entries.filter((entry) => {
            if (typeof entry !== "object" || entry === null) {
              return false;
            }

            const candidate = entry as {
              cacheKey?: unknown;
              sessionId?: unknown;
              updatedAt?: unknown;
            };
            return (
              typeof candidate.cacheKey === "string" &&
              typeof candidate.sessionId === "string" &&
              typeof candidate.updatedAt === "number" &&
              Number.isFinite(candidate.updatedAt)
            );
          }) as PlanningArtifactIndexEntry[])
        : [];

      return {
        version: 1,
        entries: this.normalizePlanningArtifactEntries(entries),
      };
    } catch {
      return { version: 1, entries: [] };
    }
  }

  private normalizePlanningArtifactEntries(
    entries: readonly PlanningArtifactIndexEntry[],
  ): PlanningArtifactIndexEntry[] {
    const byCacheKeyAndSession = new Map<string, PlanningArtifactIndexEntry>();
    for (const entry of [...entries].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )) {
      const dedupeKey = `${entry.cacheKey}::${entry.sessionId}`;
      if (!byCacheKeyAndSession.has(dedupeKey)) {
        byCacheKeyAndSession.set(dedupeKey, entry);
      }
    }

    return [...byCacheKeyAndSession.values()].slice(
      0,
      this.planningArtifactRetentionLimit,
    );
  }

  private writePlanningArtifactIndex(index: PlanningArtifactIndexFile): void {
    const path = this.planningArtifactIndexPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }
}
