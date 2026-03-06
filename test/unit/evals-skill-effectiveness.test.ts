import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillEffectivenessStore } from "../../src/evals/index.js";

describe("SkillEffectivenessStore", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("aggregates activations across skills deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-skill-evals-"));
    cleanupPaths.push(root);

    const store = new SkillEffectivenessStore({
      evalsRoot: root,
      now: () => 10,
    });

    store.recordActivation({
      sessionId: "session-skill-1",
      skillName: "typescript-best-practices",
      success: true,
      latencyMs: 12,
      tokens: 200,
    });
    store.recordActivation({
      sessionId: "session-skill-2",
      skillName: "typescript-best-practices",
      success: false,
      latencyMs: 20,
      tokens: 100,
    });
    store.recordActivation({
      sessionId: "session-skill-3",
      skillName: "nodejs-backend-patterns",
      success: true,
      latencyMs: 8,
      tokens: 40,
    });

    const all = store.summarizeAllSkills();
    expect(all.map((entry) => entry.skillName)).toEqual([
      "nodejs-backend-patterns",
      "typescript-best-practices",
    ]);
    expect(all[1]?.successRate).toBe(0.5);
  });

  it("prunes old skill activations by max age", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-skill-prune-"));
    cleanupPaths.push(root);

    const now = 150 * 86_400_000;
    const store = new SkillEffectivenessStore({
      evalsRoot: root,
      now: () => now,
    });

    store.recordActivation({
      sessionId: "session-skill-prune",
      skillName: "typescript-best-practices",
      success: true,
      latencyMs: 5,
      tokens: 5,
      timestamp: now - 35 * 86_400_000,
    });
    store.recordActivation({
      sessionId: "session-skill-prune",
      skillName: "typescript-best-practices",
      success: true,
      latencyMs: 5,
      tokens: 5,
      timestamp: now - 1 * 86_400_000,
    });

    const prune = store.prune({ maxAgeDays: 30 });
    const summary = store.summarizeSkill("typescript-best-practices");

    expect(prune.recordsDeleted).toBe(1);
    expect(summary.activations).toBe(1);
    expect(summary.successRate).toBe(1);
  });

  it("rejects path traversal-like skill names", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-p-skill-evals-"));
    cleanupPaths.push(root);

    const store = new SkillEffectivenessStore({
      evalsRoot: root,
      now: () => 10,
    });

    expect(() =>
      store.recordActivation({
        sessionId: "session-skill-1",
        skillName: "../escape",
        success: true,
        latencyMs: 12,
        tokens: 200,
      }),
    ).toThrow("skill name may only contain");
  });
});
