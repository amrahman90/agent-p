export type Token<T> = string & { readonly __type?: T };

export interface Container {
  /**
   * Registers a transient service factory
   * @param token - Unique identifier for the service
   * @param factory - Factory function that creates the service instance
   */
  register<T>(token: Token<T>, factory: () => T): void;
  /**
   * Registers a singleton service factory (created once, reused)
   * @param token - Unique identifier for the service
   * @param factory - Factory function that creates the singleton instance
   */
  registerSingleton<T>(token: Token<T>, factory: () => T): void;
  /**
   * Resolves a registered service or throws if not found
   * @param token - Unique identifier for the service
   * @returns The resolved service instance
   * @throws Error if no provider is registered for the token
   */
  resolve<T>(token: Token<T>): T;
  /**
   * Resolves a registered service or returns fallback if not found
   * @param token - Unique identifier for the service
   * @param fallback - Default value to return if token is not registered
   * @returns The resolved service instance or fallback
   */
  resolveOr<T>(token: Token<T>, fallback: T): T;
  /**
   * Resolves a registered service or returns undefined if not found
   * @param token - Unique identifier for the service
   * @returns The resolved service instance or undefined if not registered
   */
  resolveOptional<T>(token: Token<T>): T | undefined;
}

interface Registration<T> {
  readonly factory: () => T;
  readonly singleton: boolean;
  instance?: T;
}

/**
 * Service Container - Simple dependency injection container for managing service lifecycles
 *
 * @remarks
 * Provides a lightweight DI container supporting both transient and singleton registrations.
 * Used for managing application services, database connections, and agent orchestrators.
 *
 * @example
 * ```typescript
 * const container = new ServiceContainer();
 * container.register<SearchEngine>('SearchEngine', () => new SearchEngine());
 * container.registerSingleton<SkillRegistry>('SkillRegistry', () => new SkillRegistry());
 * const search = container.resolve<SearchEngine>('SearchEngine');
 * ```
 */
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

  resolveOptional<T>(token: Token<T>): T | undefined {
    if (!this.registrations.has(token)) {
      return undefined;
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
