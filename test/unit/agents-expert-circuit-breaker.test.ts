import { vi, describe, expect, it, beforeEach } from "vitest";

import {
  ExpertOrchestrator,
  QUALITY_GATE_SKIP_REASON_MAP,
} from "../../src/agents/index.js";
import type {
  ExpertQualityExecutionRequest,
  ExpertQualitySubagents,
} from "../../src/agents/types.js";

describe("ExpertOrchestrator circuit breaker", () => {
  let orchestrator: ExpertOrchestrator;
  let mockClock: () => number;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000;
    mockClock = vi.fn(() => currentTime);
    orchestrator = new ExpertOrchestrator(mockClock);
  });

  const createMockSubagents = (
    failCount: number = 0,
  ): ExpertQualitySubagents => {
    let callCount = 0;
    return {
      tester: {
        plan: vi.fn().mockResolvedValue({}),
      },
      reviewer: {
        assess: vi.fn().mockImplementation(() => {
          callCount += 1;
          if (callCount <= failCount) {
            throw new Error("Simulated failure");
          }
          return Promise.resolve({
            findings: [],
            severity: "info",
            summary: "ok",
          });
        }),
      },
      verifier: {
        assess: vi.fn().mockImplementation(() => {
          callCount += 1;
          if (callCount <= failCount) {
            throw new Error("Simulated failure");
          }
          return Promise.resolve({
            gateDecision: "pass",
            summary: "ok",
          });
        }),
      },
    };
  };

  const createRequest = (
    overrides: Partial<ExpertQualityExecutionRequest> = {},
  ): ExpertQualityExecutionRequest => ({
    sessionId: "test-session",
    query: "Test query",
    filePaths: [],
    ...overrides,
  });

  it("should not open circuit when no failures occur", async () => {
    const subagents = createMockSubagents(0);
    const request = createRequest();

    const result = await orchestrator.executeQualityPath(
      request,
      subagents,
      {},
    );

    expect(result.qualitySummary.resilience.circuitOpen).toBe(false);
    expect(result.qualitySummary.resilience.failures).toBe(0);
  });

  it("should open circuit after threshold failures when continueOnStageFailure is true", async () => {
    const subagents = createMockSubagents(10);
    const request = createRequest();

    const result = await orchestrator.executeQualityPath(request, subagents, {
      circuitBreakerFailureThreshold: 2,
      continueOnStageFailure: true,
      maxStageRetries: 0,
    });

    expect(result.qualitySummary.resilience.circuitOpen).toBe(true);
    expect(result.qualitySummary.resilience.failures).toBe(2);
    expect(result.qualitySummary.reasonCodes).toContain(
      "resilience_circuit_open",
    );
  });

  it("should skip remaining stages when circuit is open", async () => {
    const subagents = createMockSubagents(10);
    const request = createRequest();

    const result = await orchestrator.executeQualityPath(request, subagents, {
      circuitBreakerFailureThreshold: 1,
      continueOnStageFailure: true,
      maxStageRetries: 0,
    });

    const skippedSteps = result.steps.filter((s) => s.status === "skipped");
    const circuitOpenSkips = skippedSteps.filter(
      (s) => s.skipReason === QUALITY_GATE_SKIP_REASON_MAP.circuitOpen,
    );

    expect(circuitOpenSkips.length).toBeGreaterThan(0);
    expect(result.qualitySummary.resilience.circuitOpen).toBe(true);
  });

  it("should respect custom circuit breaker threshold of 1", async () => {
    const subagents = createMockSubagents(10);
    const request = createRequest();

    const result = await orchestrator.executeQualityPath(request, subagents, {
      circuitBreakerFailureThreshold: 1,
      continueOnStageFailure: true,
      maxStageRetries: 0,
    });

    expect(result.qualitySummary.resilience.circuitOpen).toBe(true);
    expect(result.qualitySummary.resilience.failures).toBe(1);
  });

  it("should include circuit_open reason code when circuit is open", async () => {
    const subagents = createMockSubagents(10);
    const request = createRequest();

    const result = await orchestrator.executeQualityPath(request, subagents, {
      circuitBreakerFailureThreshold: 2,
      continueOnStageFailure: true,
      maxStageRetries: 0,
    });

    expect(result.qualitySummary.reasonCodes).toContain(
      "resilience_circuit_open",
    );
  });

  it("should reset circuit on new execution", async () => {
    const failingSubagents = createMockSubagents(10);
    const request = createRequest();

    const result1 = await orchestrator.executeQualityPath(
      request,
      failingSubagents,
      {
        circuitBreakerFailureThreshold: 2,
        continueOnStageFailure: true,
        maxStageRetries: 0,
      },
    );
    expect(result1.qualitySummary.resilience.circuitOpen).toBe(true);

    const passingSubagents = createMockSubagents(0);
    const result2 = await orchestrator.executeQualityPath(
      request,
      passingSubagents,
      {
        circuitBreakerFailureThreshold: 2,
        continueOnStageFailure: true,
        maxStageRetries: 0,
      },
    );
    expect(result2.qualitySummary.resilience.circuitOpen).toBe(false);
    expect(result2.qualitySummary.resilience.failures).toBe(0);
  });
});
