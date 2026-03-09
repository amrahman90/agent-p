export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  WORKFLOW_ERROR = "WORKFLOW_ERROR",
  MEMORY_ERROR = "MEMORY_ERROR",
  SEARCH_ERROR = "SEARCH_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXECUTION_ERROR = "EXECUTION_ERROR",
  SKILL_ERROR = "SKILL_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  NOT_FOUND_ERROR = "NOT_FOUND_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export abstract class AgentPError extends Error {
  abstract readonly code: ErrorCode;
  readonly timestamp: number;
  override readonly cause: Error | undefined;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = Date.now();
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.VALIDATION_ERROR;
  readonly issues: readonly unknown[] | undefined;

  constructor(message: string, issues?: readonly unknown[], cause?: Error) {
    super(message, cause);
    this.issues = issues;
  }
}

export class ConfigurationError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.CONFIGURATION_ERROR;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

export class WorkflowError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.WORKFLOW_ERROR;
  readonly workflowId: string | undefined;
  readonly step: string | undefined;

  constructor(
    message: string,
    workflowId?: string,
    step?: string,
    cause?: Error,
  ) {
    super(message, cause);
    this.workflowId = workflowId;
    this.step = step;
  }
}

export class MemoryError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.MEMORY_ERROR;
  readonly operation: string | undefined;

  constructor(message: string, operation?: string, cause?: Error) {
    super(message, cause);
    this.operation = operation;
  }
}

export class SearchError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.SEARCH_ERROR;
  readonly query: string | undefined;

  constructor(message: string, query?: string, cause?: Error) {
    super(message, cause);
    this.query = query;
  }
}

export class DatabaseError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.DATABASE_ERROR;
  readonly operation: string | undefined;

  constructor(message: string, operation?: string, cause?: Error) {
    super(message, cause);
    this.operation = operation;
  }
}

export class ExecutionError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.EXECUTION_ERROR;
  readonly stage: string | undefined;

  constructor(message: string, stage?: string, cause?: Error) {
    super(message, cause);
    this.stage = stage;
  }
}

export class SkillError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.SKILL_ERROR;
  readonly skillId: string | undefined;

  constructor(message: string, skillId?: string, cause?: Error) {
    super(message, cause);
    this.skillId = skillId;
  }
}

export class NetworkError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.NETWORK_ERROR;
  readonly url: string | undefined;

  constructor(message: string, url?: string, cause?: Error) {
    super(message, cause);
    this.url = url;
  }
}

export class NotFoundError extends AgentPError {
  readonly code: ErrorCode = ErrorCode.NOT_FOUND_ERROR;
  readonly resource: string | undefined;
  readonly identifier: string | undefined;

  constructor(
    message: string,
    resource?: string,
    identifier?: string,
    cause?: Error,
  ) {
    super(message, cause);
    this.resource = resource;
    this.identifier = identifier;
  }
}
