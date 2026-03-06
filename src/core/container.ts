export type Token<T> = string & { readonly __type?: T };

export interface Container {
  register<T>(token: Token<T>, factory: () => T): void;
  registerSingleton<T>(token: Token<T>, factory: () => T): void;
  resolve<T>(token: Token<T>): T;
  resolveOr<T>(token: Token<T>, fallback: T): T;
}

interface Registration<T> {
  readonly factory: () => T;
  readonly singleton: boolean;
  instance?: T;
}

export class ServiceContainer implements Container {
  private readonly registrations = new Map<
    Token<unknown>,
    Registration<unknown>
  >();

  register<T>(token: Token<T>, factory: () => T): void {
    this.registrations.set(token, { factory, singleton: false });
  }

  registerSingleton<T>(token: Token<T>, factory: () => T): void {
    this.registrations.set(token, { factory, singleton: true });
  }

  resolve<T>(token: Token<T>): T {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new Error(`No provider registered for token: ${token}`);
    }

    if (!registration.singleton) {
      return registration.factory() as T;
    }

    if (registration.instance === undefined) {
      registration.instance = registration.factory();
    }

    return registration.instance as T;
  }

  resolveOr<T>(token: Token<T>, fallback: T): T {
    if (!this.registrations.has(token)) {
      return fallback;
    }

    return this.resolve(token);
  }
}

export const TOKENS = {
  Config: "Config",
  DatabaseManager: "DatabaseManager",
  MemoryManager: "MemoryManager",
  SearchEngine: "SearchEngine",
  SkillRegistry: "SkillRegistry",
  SkillActivator: "SkillActivator",
  ExpertOrchestrator: "ExpertOrchestrator",
  ScoutSubagent: "ScoutSubagent",
  BuilderSubagent: "BuilderSubagent",
  TesterSubagent: "TesterSubagent",
  ReviewerSubagent: "ReviewerSubagent",
  VerifierSubagent: "VerifierSubagent",
  D3WorkflowEngine: "D3WorkflowEngine",
  D3WorkflowCheckpointStore: "D3WorkflowCheckpointStore",
  SessionStartHook: "SessionStartHook",
  PreToolUseHook: "PreToolUseHook",
  PostToolUseHook: "PostToolUseHook",
  StopHook: "StopHook",
  NotificationHook: "NotificationHook",
  SessionMetricsTracker: "SessionMetricsTracker",
  CostTrackingMiddleware: "CostTrackingMiddleware",
  EvaluationEngine: "EvaluationEngine",
  SelfLearningPatternStore: "SelfLearningPatternStore",
  SkillEffectivenessStore: "SkillEffectivenessStore",
  ProgressReportPipeline: "ProgressReportPipeline",
} as const;
