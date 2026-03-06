import { describe, expect, it } from "vitest";

import { bootstrapContainer } from "../../src/core/bootstrap.js";
import {
  BuilderSubagent,
  ExpertOrchestrator,
  ReviewerSubagent,
  ScoutSubagent,
  TesterSubagent,
  VerifierSubagent,
} from "../../src/agents/index.js";
import {
  ServiceContainer,
  TOKENS,
  type Token,
} from "../../src/core/container.js";
import {
  NotificationHook,
  PostToolUseHook,
  PreToolUseHook,
  SessionStartHook,
  StopHook,
} from "../../src/hooks/index.js";
import {
  EvaluationEngine,
  ProgressReportPipeline,
  SelfLearningPatternStore,
  SkillEffectivenessStore,
} from "../../src/evals/index.js";
import { MemoryManager } from "../../src/memory/index.js";
import { SearchEngine } from "../../src/search/index.js";
import {
  CostTrackingMiddleware,
  SessionMetricsTracker,
} from "../../src/telemetry/index.js";
import {
  FileD3WorkflowCheckpointStore,
  type D3WorkflowCheckpointStore,
} from "../../src/workflow/index.js";
import {
  SkillActivator,
  SkillRegistry,
  type SkillManifest,
} from "../../src/skills/index.js";

describe("ServiceContainer", () => {
  it("resolves transient registrations as new instances", () => {
    const container = new ServiceContainer();
    const token = "Counter" as Token<{ value: number }>;
    let value = 0;

    container.register(token, () => ({ value: ++value }));

    const first = container.resolve(token);
    const second = container.resolve(token);

    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
  });

  it("resolves singleton registrations as same instance", () => {
    const container = new ServiceContainer();
    const token = "Singleton" as Token<{ id: string }>;

    container.registerSingleton(token, () => ({ id: "only-once" }));

    const first = container.resolve(token);
    const second = container.resolve(token);

    expect(first).toBe(second);
  });

  it("returns fallback for unknown token", () => {
    const container = new ServiceContainer();
    const token = "Unknown" as Token<number>;

    const result = container.resolveOr(token, 42);

    expect(result).toBe(42);
  });

  it("registers skill and agent services during bootstrap", () => {
    const manifest: SkillManifest = {
      version: "0.0.1",
      skills: [
        {
          id: "typescript",
          name: "TypeScript",
          description: "TypeScript patterns",
          domains: ["backend"],
          triggers: ["typescript"],
          activation: "auto",
          priority: "high",
          contextLoad: "minimal",
          permissions: { allowedAgents: ["expert", "builder"] },
        },
      ],
    };

    const container = bootstrapContainer({ manifest });
    const registry = container.resolve(
      TOKENS.SkillRegistry as Token<SkillRegistry>,
    );
    const activator = container.resolve(
      TOKENS.SkillActivator as Token<SkillActivator>,
    );
    const expert = container.resolve(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
    );
    const scout = container.resolve(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
    );
    const builder = container.resolve(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
    );
    const tester = container.resolve(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
    );
    const reviewer = container.resolve(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
    );
    const verifier = container.resolve(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
    );
    const search = container.resolve(
      TOKENS.SearchEngine as Token<SearchEngine>,
    );
    const memory = container.resolve(
      TOKENS.MemoryManager as Token<MemoryManager>,
    );
    const sessionStartHook = container.resolve(
      TOKENS.SessionStartHook as Token<SessionStartHook>,
    );
    const preToolUseHook = container.resolve(
      TOKENS.PreToolUseHook as Token<PreToolUseHook>,
    );
    const postToolUseHook = container.resolve(
      TOKENS.PostToolUseHook as Token<PostToolUseHook>,
    );
    const stopHook = container.resolve(TOKENS.StopHook as Token<StopHook>);
    const notificationHook = container.resolve(
      TOKENS.NotificationHook as Token<NotificationHook>,
    );
    const metricsTracker = container.resolve(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
    );
    const costTracker = container.resolve(
      TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
    );
    const evaluationEngine = container.resolve(
      TOKENS.EvaluationEngine as Token<EvaluationEngine>,
    );
    const selfLearningStore = container.resolve(
      TOKENS.SelfLearningPatternStore as Token<SelfLearningPatternStore>,
    );
    const skillEffectivenessStore = container.resolve(
      TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
    );
    const progressReportPipeline = container.resolve(
      TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
    );
    const workflowCheckpointStore = container.resolve(
      TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
    );

    expect(registry.has("typescript")).toBe(true);
    expect(
      activator
        .activate({ query: "typescript backend", agentId: "expert" })
        .map((skill) => skill.id),
    ).toEqual(["typescript"]);
    expect(
      expert.createScoutHandoff({
        sessionId: "s1",
        query: "find ts",
      }).to,
    ).toBe("scout");
    expect(scout).toBeInstanceOf(ScoutSubagent);
    expect(
      expert.createBuilderHandoff({
        sessionId: "s1",
        query: "implement ts",
      }).to,
    ).toBe("builder");
    expect(builder).toBeInstanceOf(BuilderSubagent);
    expect(
      expert.createTesterHandoff({
        sessionId: "s1",
        query: "test ts",
      }).to,
    ).toBe("tester");
    expect(tester).toBeInstanceOf(TesterSubagent);
    expect(
      expert.createReviewerHandoff({
        sessionId: "s1",
        query: "review ts",
      }).to,
    ).toBe("reviewer");
    expect(reviewer).toBeInstanceOf(ReviewerSubagent);
    expect(
      expert.createVerifierHandoff({
        sessionId: "s1",
        query: "verify ts",
      }).to,
    ).toBe("verifier");
    expect(verifier).toBeInstanceOf(VerifierSubagent);
    expect(search).toBeInstanceOf(SearchEngine);
    expect(memory).toBeInstanceOf(MemoryManager);
    expect(sessionStartHook).toBeInstanceOf(SessionStartHook);
    expect(preToolUseHook).toBeInstanceOf(PreToolUseHook);
    expect(postToolUseHook).toBeInstanceOf(PostToolUseHook);
    expect(stopHook).toBeInstanceOf(StopHook);
    expect(notificationHook).toBeInstanceOf(NotificationHook);
    expect(metricsTracker).toBeInstanceOf(SessionMetricsTracker);
    expect(costTracker).toBeInstanceOf(CostTrackingMiddleware);
    expect(evaluationEngine).toBeInstanceOf(EvaluationEngine);
    expect(selfLearningStore).toBeInstanceOf(SelfLearningPatternStore);
    expect(skillEffectivenessStore).toBeInstanceOf(SkillEffectivenessStore);
    expect(progressReportPipeline).toBeInstanceOf(ProgressReportPipeline);
    expect(workflowCheckpointStore).toBeInstanceOf(
      FileD3WorkflowCheckpointStore,
    );
  });
});
