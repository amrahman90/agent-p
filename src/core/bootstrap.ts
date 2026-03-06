import {
  BuilderSubagent,
  ExpertOrchestrator,
  ReviewerSubagent,
  ScoutSubagent,
  TesterSubagent,
  VerifierSubagent,
} from "../agents/index.js";
import { MemoryManager } from "../memory/index.js";
import { SearchEngine } from "../search/index.js";
import {
  NotificationHook,
  PostToolUseHook,
  PreToolUseHook,
  SessionStartHook,
  StopHook,
} from "../hooks/index.js";
import {
  EvaluationEngine,
  ProgressReportPipeline,
  SelfLearningPatternStore,
  SkillEffectivenessStore,
} from "../evals/index.js";
import {
  CostTrackingMiddleware,
  SessionMetricsTracker,
} from "../telemetry/index.js";
import {
  SkillActivator,
  SkillRegistry,
  loadSkillManifest,
  type LoadSkillManifestOptions,
  type SkillManifest,
  validateSkillManifest,
} from "../skills/index.js";
import {
  FileD3WorkflowCheckpointStore,
  type D3WorkflowCheckpointStore,
} from "../workflow/index.js";
import { ServiceContainer, TOKENS, type Token } from "./container.js";
import { join } from "node:path";

export interface BootstrapContainerOptions extends LoadSkillManifestOptions {
  readonly manifest?: SkillManifest;
  readonly workspaceRoot?: string;
}

export const bootstrapContainer = (
  options: BootstrapContainerOptions = {},
): ServiceContainer => {
  const container = new ServiceContainer();
  const manifest =
    options.manifest ??
    loadSkillManifest({
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.manifestPath !== undefined
        ? { manifestPath: options.manifestPath }
        : {}),
    });

  const validation = validateSkillManifest(manifest);
  if (!validation.valid) {
    throw new Error(
      `Skill manifest validation failed: ${validation.errors
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  const registry = SkillRegistry.fromManifest(manifest);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const telemetryRoot = join(workspaceRoot, ".agent-p", "telemetry");
  const evalsRoot = join(workspaceRoot, ".agent-p", "evals");
  const workflowRoot = join(workspaceRoot, ".agent-p", "workflow");

  container.registerSingleton(
    TOKENS.SkillRegistry as Token<SkillRegistry>,
    () => registry,
  );
  container.registerSingleton(
    TOKENS.SkillActivator as Token<SkillActivator>,
    () => new SkillActivator(registry),
  );
  container.registerSingleton(
    TOKENS.SearchEngine as Token<SearchEngine>,
    () =>
      new SearchEngine({
        workspaceRoot,
        telemetryRecorder: container.resolve(
          TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
        ),
      }),
  );
  container.registerSingleton(
    TOKENS.MemoryManager as Token<MemoryManager>,
    () => new MemoryManager(),
  );
  container.registerSingleton(
    TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
    () => new ExpertOrchestrator(),
  );
  container.registerSingleton(
    TOKENS.ScoutSubagent as Token<ScoutSubagent>,
    () =>
      new ScoutSubagent(
        container.resolve(TOKENS.SearchEngine as Token<SearchEngine>),
        container.resolve(TOKENS.MemoryManager as Token<MemoryManager>),
      ),
  );
  container.registerSingleton(
    TOKENS.BuilderSubagent as Token<BuilderSubagent>,
    () => new BuilderSubagent(),
  );
  container.registerSingleton(
    TOKENS.TesterSubagent as Token<TesterSubagent>,
    () => new TesterSubagent(),
  );
  container.registerSingleton(
    TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
    () => new ReviewerSubagent(),
  );
  container.registerSingleton(
    TOKENS.VerifierSubagent as Token<VerifierSubagent>,
    () => new VerifierSubagent(),
  );
  container.registerSingleton(
    TOKENS.SessionStartHook as Token<SessionStartHook>,
    () => new SessionStartHook(),
  );
  container.registerSingleton(
    TOKENS.PreToolUseHook as Token<PreToolUseHook>,
    () => new PreToolUseHook(),
  );
  container.registerSingleton(
    TOKENS.PostToolUseHook as Token<PostToolUseHook>,
    () => new PostToolUseHook(),
  );
  container.registerSingleton(
    TOKENS.StopHook as Token<StopHook>,
    () => new StopHook(),
  );
  container.registerSingleton(
    TOKENS.NotificationHook as Token<NotificationHook>,
    () => new NotificationHook(),
  );
  container.registerSingleton(
    TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
    () => new CostTrackingMiddleware({ telemetryRoot }),
  );
  container.registerSingleton(
    TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
    () =>
      new SessionMetricsTracker({
        telemetryRoot,
        costMiddleware: container.resolve(
          TOKENS.CostTrackingMiddleware as Token<CostTrackingMiddleware>,
        ),
      }),
  );
  container.registerSingleton(
    TOKENS.EvaluationEngine as Token<EvaluationEngine>,
    () => new EvaluationEngine(),
  );
  container.registerSingleton(
    TOKENS.SelfLearningPatternStore as Token<SelfLearningPatternStore>,
    () => new SelfLearningPatternStore({ telemetryRoot }),
  );
  container.registerSingleton(
    TOKENS.SkillEffectivenessStore as Token<SkillEffectivenessStore>,
    () => new SkillEffectivenessStore({ evalsRoot }),
  );
  container.registerSingleton(
    TOKENS.ProgressReportPipeline as Token<ProgressReportPipeline>,
    () => new ProgressReportPipeline({ telemetryRoot }),
  );
  container.registerSingleton(
    TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
    () => new FileD3WorkflowCheckpointStore({ workflowRoot }),
  );

  return container;
};
