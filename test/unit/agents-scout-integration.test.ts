import { describe, expect, it, vi } from "vitest";

import { ExpertOrchestrator, ScoutSubagent } from "../../src/agents/index.js";
import { createCliProgram } from "../../src/cli.js";
import {
  TOKENS,
  ServiceContainer,
  type Token,
} from "../../src/core/container.js";
import { MemoryManager } from "../../src/memory/index.js";
import { SearchEngine, type SearchHit } from "../../src/search/index.js";

describe("agents:scout CLI integration", () => {
  it("runs CLI -> handoff validation -> real SearchEngine -> scout analysis", async () => {
    const stageHits: SearchHit[] = [
      {
        filePath: "src/auth/service.ts",
        line: 1,
        column: 1,
        preview: "auth service token verification",
        score: 8,
      },
      {
        filePath: "src/auth/controller.ts",
        line: 1,
        column: 1,
        preview: "controller delegates to auth service",
        score: 7,
      },
      {
        filePath: "src/auth/controller.ts",
        line: 2,
        column: 1,
        preview: "auth controller route",
        score: 6,
      },
    ];

    const searchStage = {
      searchSanitized: vi.fn().mockResolvedValue(stageHits),
    };

    const container = new ServiceContainer();
    const search = new SearchEngine({
      workspaceRoot: process.cwd(),
      stage: searchStage,
    });
    const memory = new MemoryManager();
    memory.shared.set(
      "auth-service-pattern",
      "service token verification policy",
    );

    container.registerSingleton(
      TOKENS.SearchEngine as Token<SearchEngine>,
      () => search,
    );
    container.registerSingleton(
      TOKENS.MemoryManager as Token<MemoryManager>,
      () => memory,
    );
    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_000),
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () =>
        new ScoutSubagent(
          container.resolve(TOKENS.SearchEngine as Token<SearchEngine>),
          container.resolve(TOKENS.MemoryManager as Token<MemoryManager>),
        ),
    );

    const writes: string[] = [];
    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:scout",
      "auth service",
      "--session",
      "session-100",
      "--domains",
      "backend",
      "--files",
      "src/auth/service.ts",
    ]);

    expect(searchStage.searchSanitized).toHaveBeenCalledTimes(1);

    const output = writes.join("").trim();
    const payload = JSON.parse(output) as {
      handoff: {
        to: string;
        sessionId: string;
        metadata: { reason: string; timestamp: number };
      };
      analysis: {
        relevantFiles: string[];
        rankedFiles: Array<{ filePath: string; confidence: number }>;
        notes: string[];
      };
    };

    expect(payload.handoff.to).toBe("scout");
    expect(payload.handoff.sessionId).toBe("session-100");
    expect(payload.handoff.metadata.reason).toBe("context_discovery");
    expect(payload.handoff.metadata.timestamp).toBe(1_700_000_000_000);

    expect(payload.analysis.relevantFiles).toEqual([
      "src/auth/service.ts",
      "src/auth/controller.ts",
    ]);
    expect(payload.analysis.rankedFiles).toHaveLength(2);
    expect(payload.analysis.rankedFiles[0]?.filePath).toBe(
      "src/auth/service.ts",
    );
    expect(
      payload.analysis.rankedFiles[0]?.confidence ?? 0,
    ).toBeGreaterThanOrEqual(payload.analysis.rankedFiles[1]?.confidence ?? 0);
    expect(payload.analysis.notes).toContain(
      "Top 2 files ranked with deterministic tie-breakers.",
    );
    expect(payload.analysis.notes).not.toContain(
      "Memory matched 1 related entries.",
    );
    expect(
      payload.analysis.rankedFiles[0]?.filePath === "src/auth/service.ts",
    ).toBe(true);
  });

  it("does not let shared/user/private memory affect scout memory notes", async () => {
    const stageHits: SearchHit[] = [
      {
        filePath: "src/auth/service.ts",
        line: 1,
        column: 1,
        preview: "auth service token verification",
        score: 8,
      },
    ];

    const searchStage = {
      searchSanitized: vi.fn().mockResolvedValue(stageHits),
    };

    const search = new SearchEngine({
      workspaceRoot: process.cwd(),
      stage: searchStage,
    });
    const memory = new MemoryManager({ sessionId: "session-iso" });
    memory.shared.set(
      "auth-service-pattern",
      "auth service token verification",
    );
    memory.user.set("auth-user-pref", "auth service token verification");
    memory
      .privateScope("builder")
      .set("auth-private-note", "auth service token verification");

    const scout = new ScoutSubagent(search, memory);

    const result = await scout.analyze({
      handoff: {
        from: "expert",
        to: "scout",
        sessionId: "session-other",
        handoffId: "handoff-scout-iso-1",
        attempt: 1,
        query: "auth service",
        filePaths: ["src/auth/service.ts"],
        domains: ["backend"],
        metadata: {
          reason: "context_discovery",
          priority: "normal",
          timestamp: 1_700_000_000_000,
        },
      },
    });

    expect(searchStage.searchSanitized).toHaveBeenCalledTimes(1);
    expect(result.notes).not.toContain("Memory matched 1 related entries.");
    expect(result.rankedFiles[0]?.reasons).not.toContain("memory hit");
  });
});
