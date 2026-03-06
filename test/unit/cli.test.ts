import { describe, expect, it, vi } from "vitest";

import { ExpertOrchestrator } from "../../src/agents/index.js";
import type {
  BuilderSubagent,
  ReviewerSubagent,
  ScoutSubagent,
  TesterSubagent,
  VerifierSubagent,
} from "../../src/agents/index.js";
import type { SessionStartHook } from "../../src/hooks/index.js";
import { createCliProgram, runCli } from "../../src/cli.js";
import {
  ServiceContainer,
  TOKENS,
  type Token,
} from "../../src/core/container.js";
import type { EvaluationEngine } from "../../src/evals/index.js";
import { SkillActivator, SkillRegistry } from "../../src/skills/index.js";
import type { SkillDefinition } from "../../src/skills/index.js";
import type { SessionMetricsTracker } from "../../src/telemetry/index.js";
import type {
  D3WorkflowCheckpoint,
  D3WorkflowCheckpointStore,
  D3WorkflowEngine,
} from "../../src/workflow/index.js";

describe("CLI agents:scout", () => {
  it("parses options and prints validated handoff + analysis payload", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createScoutHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "scout",
        sessionId: "session-42",
        handoffId: "h-scout-42",
        attempt: 1,
        query: "trace auth",
        filePaths: ["src/auth.ts"],
        domains: ["backend"],
        metadata: {
          reason: "context_discovery",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const scout = {
      analyze: vi.fn().mockResolvedValue({
        summary: "Scout found 1 relevant files for query: trace auth",
        relevantFiles: ["src/auth.ts"],
        rankedFiles: [
          {
            filePath: "src/auth.ts",
            confidence: 0.9,
            reasons: ["matched terms (2/2)", "domain overlap (backend)"],
          },
        ],
        domains: ["backend"],
        notes: ["Search returned 1 candidate hits."],
        risks: [],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () => scout as unknown as ScoutSubagent,
    );

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
      "trace auth",
      "--session",
      "session-42",
      "--files",
      "src/auth.ts",
      "--domains",
      "backend",
    ]);

    expect(expert.createScoutHandoff).toHaveBeenCalledWith({
      sessionId: "session-42",
      query: "trace auth",
      filePaths: ["src/auth.ts"],
      domains: ["backend"],
    });
    expect(scout.analyze).toHaveBeenCalledTimes(1);

    const output = writes.join("").trim();
    const payload = JSON.parse(output) as {
      handoff: {
        to: string;
        sessionId: string;
        query: string;
        handoffId: string;
      };
      analysis: { summary: string; relevantFiles: string[] };
    };

    expect(payload.handoff.to).toBe("scout");
    expect(payload.handoff.sessionId).toBe("session-42");
    expect(payload.handoff.query).toBe("trace auth");
    expect(payload.handoff.handoffId).toBe("h-scout-42");
    expect(payload.analysis.relevantFiles).toEqual(["src/auth.ts"]);
    expect(payload).toMatchInlineSnapshot(`
      {
        "analysis": {
          "domains": [
            "backend",
          ],
          "notes": [
            "Search returned 1 candidate hits.",
          ],
          "rankedFiles": [
            {
              "confidence": 0.9,
              "filePath": "src/auth.ts",
              "reasons": [
                "matched terms (2/2)",
                "domain overlap (backend)",
              ],
            },
          ],
          "relevantFiles": [
            "src/auth.ts",
          ],
          "risks": [],
          "summary": "Scout found 1 relevant files for query: trace auth",
        },
        "handoff": {
          "attempt": 1,
          "domains": [
            "backend",
          ],
          "filePaths": [
            "src/auth.ts",
          ],
          "from": "expert",
          "handoffId": "h-scout-42",
          "metadata": {
            "priority": "normal",
            "reason": "context_discovery",
            "timestamp": 1,
          },
          "query": "trace auth",
          "sessionId": "session-42",
          "to": "scout",
        },
      }
    `);
  });

  it("rejects invalid session values through handoff validation", async () => {
    const container = new ServiceContainer();
    const expert = new ExpertOrchestrator(() => 10);
    const scout = {
      analyze: vi.fn().mockResolvedValue({
        summary: "noop",
        relevantFiles: [],
        rankedFiles: [],
        domains: [],
        notes: [],
        risks: [],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert,
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () => scout as unknown as ScoutSubagent,
    );

    const program = createCliProgram({
      container,
      stdout: { write: () => true },
    });

    await expect(
      program.parseAsync([
        "node",
        "agent-p",
        "agents:scout",
        "trace auth",
        "--session",
        "invalid session",
      ]),
    ).rejects.toThrow();
    expect(scout.analyze).not.toHaveBeenCalled();
  });
});

describe("CLI agents:builder", () => {
  it("parses options and prints validated handoff + plan payload", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createBuilderHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "builder",
        sessionId: "session-77",
        handoffId: "h-builder-77",
        attempt: 1,
        query: "implement auth",
        filePaths: ["src/auth.ts"],
        domains: ["backend"],
        metadata: {
          reason: "implementation_planning",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const builder = {
      plan: vi.fn().mockResolvedValue({
        summary:
          "Builder scaffold prepared implementation plan for: implement auth",
        plannedChanges: ["src/auth.ts", "domain:backend"],
        risks: [
          "Builder implementation remains scaffolded and does not modify files yet.",
        ],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () => builder as unknown as BuilderSubagent,
    );

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
      "agents:builder",
      "implement auth",
      "--session",
      "session-77",
      "--files",
      "src/auth.ts",
      "--domains",
      "backend",
    ]);

    expect(expert.createBuilderHandoff).toHaveBeenCalledWith({
      sessionId: "session-77",
      query: "implement auth",
      filePaths: ["src/auth.ts"],
      domains: ["backend"],
    });
    expect(builder.plan).toHaveBeenCalledTimes(1);

    const output = writes.join("").trim();
    const payload = JSON.parse(output) as {
      handoff: {
        to: string;
        sessionId: string;
        query: string;
        handoffId: string;
      };
      plan: { plannedChanges: string[] };
    };

    expect(payload.handoff.to).toBe("builder");
    expect(payload.handoff.sessionId).toBe("session-77");
    expect(payload.handoff.query).toBe("implement auth");
    expect(payload.handoff.handoffId).toBe("h-builder-77");
    expect(payload.plan.plannedChanges).toEqual([
      "src/auth.ts",
      "domain:backend",
    ]);
    expect(payload).toMatchInlineSnapshot(`
      {
        "handoff": {
          "attempt": 1,
          "domains": [
            "backend",
          ],
          "filePaths": [
            "src/auth.ts",
          ],
          "from": "expert",
          "handoffId": "h-builder-77",
          "metadata": {
            "priority": "normal",
            "reason": "implementation_planning",
            "timestamp": 1,
          },
          "query": "implement auth",
          "sessionId": "session-77",
          "to": "builder",
        },
        "plan": {
          "plannedChanges": [
            "src/auth.ts",
            "domain:backend",
          ],
          "risks": [
            "Builder implementation remains scaffolded and does not modify files yet.",
          ],
          "summary": "Builder scaffold prepared implementation plan for: implement auth",
        },
      }
    `);
  });
});

describe("CLI agents:tester", () => {
  it("parses options and prints validated handoff + plan payload", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createTesterHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "tester",
        sessionId: "session-88",
        handoffId: "h-tester-88",
        attempt: 1,
        query: "test auth",
        filePaths: ["src/auth.ts"],
        domains: ["backend"],
        metadata: {
          reason: "test_planning",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const tester = {
      plan: vi.fn().mockResolvedValue({
        summary: "Tester scaffold prepared verification plan for: test auth",
        commands: ["pnpm test"],
        expectedChecks: ["Unit and integration test suites pass."],
        failureHandling: [
          "Capture failing command output with stack traces and exit code.",
        ],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester as unknown as TesterSubagent,
    );

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
      "agents:tester",
      "test auth",
      "--session",
      "session-88",
      "--files",
      "src/auth.ts",
      "--domains",
      "backend",
    ]);

    expect(expert.createTesterHandoff).toHaveBeenCalledWith({
      sessionId: "session-88",
      query: "test auth",
      filePaths: ["src/auth.ts"],
      domains: ["backend"],
    });
    expect(tester.plan).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(writes.join("")) as {
      handoff: { to: string };
      plan: { commands: string[] };
    };
    expect(payload.handoff.to).toBe("tester");
    expect(payload.plan.commands).toEqual(["pnpm test"]);
    expect(payload).toMatchInlineSnapshot(`
      {
        "handoff": {
          "attempt": 1,
          "domains": [
            "backend",
          ],
          "filePaths": [
            "src/auth.ts",
          ],
          "from": "expert",
          "handoffId": "h-tester-88",
          "metadata": {
            "priority": "normal",
            "reason": "test_planning",
            "timestamp": 1,
          },
          "query": "test auth",
          "sessionId": "session-88",
          "to": "tester",
        },
        "plan": {
          "commands": [
            "pnpm test",
          ],
          "expectedChecks": [
            "Unit and integration test suites pass.",
          ],
          "failureHandling": [
            "Capture failing command output with stack traces and exit code.",
          ],
          "summary": "Tester scaffold prepared verification plan for: test auth",
        },
      }
    `);
  });
});

describe("CLI agents:reviewer", () => {
  it("parses options and prints validated handoff + assessment payload", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createReviewerHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "reviewer",
        sessionId: "session-89",
        handoffId: "h-reviewer-89",
        attempt: 1,
        query: "review auth",
        filePaths: ["src/auth.ts"],
        domains: ["backend"],
        metadata: {
          reason: "code_review",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const reviewer = {
      assess: vi.fn().mockResolvedValue({
        summary: "Reviewer scaffold produced 1 findings for: review auth",
        findings: [
          {
            severity: "medium",
            finding:
              "Reviewer remains scaffold-only and does not inspect code diffs yet.",
            recommendedFix:
              "Run reviewer with concrete diff context after builder implementation is available.",
          },
        ],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer as unknown as ReviewerSubagent,
    );

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
      "agents:reviewer",
      "review auth",
      "--session",
      "session-89",
    ]);

    expect(expert.createReviewerHandoff).toHaveBeenCalledWith({
      sessionId: "session-89",
      query: "review auth",
    });
    expect(reviewer.assess).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(writes.join("")) as {
      handoff: { to: string };
      assessment: { findings: unknown[] };
    };
    expect(payload.handoff.to).toBe("reviewer");
    expect(payload.assessment.findings).toHaveLength(1);
    expect(payload).toMatchInlineSnapshot(`
      {
        "assessment": {
          "findings": [
            {
              "finding": "Reviewer remains scaffold-only and does not inspect code diffs yet.",
              "recommendedFix": "Run reviewer with concrete diff context after builder implementation is available.",
              "severity": "medium",
            },
          ],
          "summary": "Reviewer scaffold produced 1 findings for: review auth",
        },
        "handoff": {
          "attempt": 1,
          "domains": [
            "backend",
          ],
          "filePaths": [
            "src/auth.ts",
          ],
          "from": "expert",
          "handoffId": "h-reviewer-89",
          "metadata": {
            "priority": "normal",
            "reason": "code_review",
            "timestamp": 1,
          },
          "query": "review auth",
          "sessionId": "session-89",
          "to": "reviewer",
        },
      }
    `);
  });
});

describe("CLI agents:verifier", () => {
  it("parses options and prints validated handoff + verification payload", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      createVerifierHandoff: vi.fn().mockReturnValue({
        from: "expert",
        to: "verifier",
        sessionId: "session-90",
        handoffId: "h-verifier-90",
        attempt: 1,
        query: "verify auth",
        filePaths: [],
        domains: [],
        metadata: {
          reason: "quality_verification",
          priority: "normal",
          timestamp: 1,
        },
      }),
    };
    const verifier = {
      assess: vi.fn().mockResolvedValue({
        summary: "Verifier scaffold evaluated release gate for: verify auth",
        trustScore: 0.95,
        threshold: 0.75,
        gateDecision: "pass",
        checks: ["testPassRate=1.000"],
        blockers: [],
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier as unknown as VerifierSubagent,
    );

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
      "agents:verifier",
      "verify auth",
      "--session",
      "session-90",
      "--test-pass-rate",
      "1",
      "--review-severity",
      "low",
      "--completeness",
      "1",
      "--evidence-quality",
      "1",
    ]);

    expect(expert.createVerifierHandoff).toHaveBeenCalledWith({
      sessionId: "session-90",
      query: "verify auth",
    });
    expect(verifier.assess).toHaveBeenCalledWith({
      handoff: expect.objectContaining({ to: "verifier" }),
      trustInput: {
        testPassRate: 1,
        reviewSeverity: "low",
        completeness: 1,
        evidenceQuality: 1,
      },
    });

    const payload = JSON.parse(writes.join("")) as {
      handoff: { to: string };
      assessment: { gateDecision: string };
    };
    expect(payload.handoff.to).toBe("verifier");
    expect(payload.assessment.gateDecision).toBe("pass");
    expect(payload).toMatchInlineSnapshot(`
      {
        "assessment": {
          "blockers": [],
          "checks": [
            "testPassRate=1.000",
          ],
          "gateDecision": "pass",
          "summary": "Verifier scaffold evaluated release gate for: verify auth",
          "threshold": 0.75,
          "trustScore": 0.95,
        },
        "handoff": {
          "attempt": 1,
          "domains": [],
          "filePaths": [],
          "from": "expert",
          "handoffId": "h-verifier-90",
          "metadata": {
            "priority": "normal",
            "reason": "quality_verification",
            "timestamp": 1,
          },
          "query": "verify auth",
          "sessionId": "session-90",
          "to": "verifier",
        },
      }
    `);
  });
});

describe("CLI agents:quality", () => {
  it("prints policy + result payload for trust-gate skip path", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [
          {
            from: "expert",
            to: "tester",
            sessionId: "session-q1",
            handoffId: "h-tester-q1",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "test_planning",
              priority: "normal",
              timestamp: 1,
            },
          },
        ],
        steps: [
          {
            handoff: {
              from: "expert",
              to: "tester",
              sessionId: "session-q1",
              handoffId: "h-tester-q1",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "test_planning",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "skipped",
            gateState: {
              trustScore: 0.2,
              goalCompletion: 1,
              trustPassed: false,
              goalPassed: true,
            },
            skipReason: "trust_gate",
          },
        ],
        finalGateState: {
          trustScore: 0.2,
          goalCompletion: 1,
          trustPassed: false,
          goalPassed: true,
        },
        qualitySummary: {
          reasonCodes: ["trust_score_below_threshold"],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q1",
      "--trust-score",
      "0.2",
    ]);

    expect(expert.executeQualityPath).toHaveBeenCalledWith(
      {
        sessionId: "session-q1",
        query: "release gate",
        gateInput: {
          trustScore: 0.2,
        },
      },
      { tester, reviewer, verifier },
      expect.objectContaining({
        continueOnTrustGateFailure: false,
        minTrustScore: 0.75,
      }),
    );

    const payload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      policy: { continueOnTrustGateFailure: boolean };
      result: { steps: Array<{ status: string; skipReason?: string }> };
    };

    expect(payload.contractVersion).toBe("1.1.0");
    expect(payload.policy.continueOnTrustGateFailure).toBe(false);
    expect(payload.result.steps[0]?.status).toBe("skipped");
    expect(payload.result.steps[0]?.skipReason).toBe("trust_gate");
    expect(payload).toMatchInlineSnapshot(`
      {
        "contractVersion": "1.1.0",
        "policy": {
          "circuitBreakerFailureThreshold": 2,
          "continueOnGoalGateFailure": false,
          "continueOnRateLimit": false,
          "continueOnStageFailure": false,
          "continueOnStageTimeout": false,
          "continueOnTrustGateFailure": false,
          "enforceGoalGate": true,
          "enforceTrustGate": true,
          "importance": 3,
          "includeReviewer": true,
          "includeTester": true,
          "includeVerifier": true,
          "maxStageRetries": 0,
          "minGoalCompletion": 1,
          "minTrustScore": 0.75,
          "rateLimitMaxExecutions": 0,
          "rateLimitWindowMs": 1000,
          "stability": 3,
          "stageTimeoutMs": 30000,
        },
        "result": {
          "finalGateState": {
            "goalCompletion": 1,
            "goalPassed": true,
            "trustPassed": false,
            "trustScore": 0.2,
          },
          "handoffs": [
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-tester-q1",
              "metadata": {
                "priority": "normal",
                "reason": "test_planning",
                "timestamp": 1,
              },
              "query": "release gate",
              "sessionId": "session-q1",
              "to": "tester",
            },
          ],
          "qualitySummary": {
            "dangerousPatterns": [],
            "reasonCodes": [
              "trust_score_below_threshold",
            ],
            "resilience": {
              "circuitOpen": false,
              "failures": 0,
              "retries": 0,
              "timeouts": 0,
            },
          },
          "steps": [
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": false,
                "trustScore": 0.2,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-tester-q1",
                "metadata": {
                  "priority": "normal",
                  "reason": "test_planning",
                  "timestamp": 1,
                },
                "query": "release gate",
                "sessionId": "session-q1",
                "to": "tester",
              },
              "skipReason": "trust_gate",
              "status": "skipped",
            },
          ],
        },
      }
    `);
  });

  it("prints policy + result payload for continue-on-trust-failure path", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [
          {
            from: "expert",
            to: "tester",
            sessionId: "session-q2",
            handoffId: "h-tester-q2",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "test_planning",
              priority: "normal",
              timestamp: 1,
            },
          },
          {
            from: "expert",
            to: "verifier",
            sessionId: "session-q2",
            handoffId: "h-verifier-q2",
            parentHandoffId: "h-tester-q2",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "quality_verification",
              priority: "normal",
              timestamp: 1,
            },
          },
        ],
        steps: [
          {
            handoff: {
              from: "expert",
              to: "tester",
              sessionId: "session-q2",
              handoffId: "h-tester-q2",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "test_planning",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 0.2,
              goalCompletion: 1,
              trustPassed: false,
              goalPassed: true,
            },
          },
          {
            handoff: {
              from: "expert",
              to: "verifier",
              sessionId: "session-q2",
              handoffId: "h-verifier-q2",
              parentHandoffId: "h-tester-q2",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "quality_verification",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 0.2,
              goalCompletion: 1,
              trustPassed: false,
              goalPassed: true,
            },
          },
        ],
        finalGateState: {
          trustScore: 0.95,
          goalCompletion: 1,
          trustPassed: true,
          goalPassed: true,
        },
        qualitySummary: {
          reasonCodes: [],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q2",
      "--trust-score",
      "0.2",
      "--continue-on-trust-failure",
      "--skip-reviewer",
      "--test-pass-rate",
      "1",
      "--review-severity",
      "low",
      "--completeness",
      "1",
      "--evidence-quality",
      "1",
    ]);

    expect(expert.executeQualityPath).toHaveBeenCalledWith(
      {
        sessionId: "session-q2",
        query: "release gate",
        gateInput: {
          trustScore: 0.2,
        },
        verifierTrustInput: {
          testPassRate: 1,
          reviewSeverity: "low",
          completeness: 1,
          evidenceQuality: 1,
        },
      },
      { tester, reviewer, verifier },
      expect.objectContaining({
        includeReviewer: false,
        continueOnTrustGateFailure: true,
      }),
    );

    const payload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      policy: {
        includeReviewer: boolean;
        continueOnTrustGateFailure: boolean;
      };
      result: { finalGateState: { trustPassed: boolean } };
    };

    expect(payload.contractVersion).toBe("1.1.0");
    expect(payload.policy.includeReviewer).toBe(false);
    expect(payload.policy.continueOnTrustGateFailure).toBe(true);
    expect(payload.result.finalGateState.trustPassed).toBe(true);
    expect(payload).toMatchInlineSnapshot(`
      {
        "contractVersion": "1.1.0",
        "policy": {
          "circuitBreakerFailureThreshold": 2,
          "continueOnGoalGateFailure": false,
          "continueOnRateLimit": false,
          "continueOnStageFailure": false,
          "continueOnStageTimeout": false,
          "continueOnTrustGateFailure": true,
          "enforceGoalGate": true,
          "enforceTrustGate": true,
          "importance": 3,
          "includeReviewer": false,
          "includeTester": true,
          "includeVerifier": true,
          "maxStageRetries": 0,
          "minGoalCompletion": 1,
          "minTrustScore": 0.75,
          "rateLimitMaxExecutions": 0,
          "rateLimitWindowMs": 1000,
          "stability": 3,
          "stageTimeoutMs": 30000,
        },
        "result": {
          "finalGateState": {
            "goalCompletion": 1,
            "goalPassed": true,
            "trustPassed": true,
            "trustScore": 0.95,
          },
          "handoffs": [
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-tester-q2",
              "metadata": {
                "priority": "normal",
                "reason": "test_planning",
                "timestamp": 1,
              },
              "query": "release gate",
              "sessionId": "session-q2",
              "to": "tester",
            },
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-verifier-q2",
              "metadata": {
                "priority": "normal",
                "reason": "quality_verification",
                "timestamp": 1,
              },
              "parentHandoffId": "h-tester-q2",
              "query": "release gate",
              "sessionId": "session-q2",
              "to": "verifier",
            },
          ],
          "qualitySummary": {
            "dangerousPatterns": [],
            "reasonCodes": [],
            "resilience": {
              "circuitOpen": false,
              "failures": 0,
              "retries": 0,
              "timeouts": 0,
            },
          },
          "steps": [
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": false,
                "trustScore": 0.2,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-tester-q2",
                "metadata": {
                  "priority": "normal",
                  "reason": "test_planning",
                  "timestamp": 1,
                },
                "query": "release gate",
                "sessionId": "session-q2",
                "to": "tester",
              },
              "status": "executed",
            },
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": false,
                "trustScore": 0.2,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-verifier-q2",
                "metadata": {
                  "priority": "normal",
                  "reason": "quality_verification",
                  "timestamp": 1,
                },
                "parentHandoffId": "h-tester-q2",
                "query": "release gate",
                "sessionId": "session-q2",
                "to": "verifier",
              },
              "status": "executed",
            },
          ],
        },
      }
    `);
  });

  it("prints contract-stable payload for all-pass quality execution", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [
          {
            from: "expert",
            to: "tester",
            sessionId: "session-q3",
            handoffId: "h-tester-q3",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "test_planning",
              priority: "normal",
              timestamp: 1,
            },
          },
          {
            from: "expert",
            to: "reviewer",
            sessionId: "session-q3",
            handoffId: "h-reviewer-q3",
            parentHandoffId: "h-tester-q3",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "code_review",
              priority: "normal",
              timestamp: 1,
            },
          },
          {
            from: "expert",
            to: "verifier",
            sessionId: "session-q3",
            handoffId: "h-verifier-q3",
            parentHandoffId: "h-reviewer-q3",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "quality_verification",
              priority: "normal",
              timestamp: 1,
            },
          },
        ],
        steps: [
          {
            handoff: {
              from: "expert",
              to: "tester",
              sessionId: "session-q3",
              handoffId: "h-tester-q3",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "test_planning",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 1,
              goalCompletion: 1,
              trustPassed: true,
              goalPassed: true,
            },
          },
          {
            handoff: {
              from: "expert",
              to: "reviewer",
              sessionId: "session-q3",
              handoffId: "h-reviewer-q3",
              parentHandoffId: "h-tester-q3",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "code_review",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 1,
              goalCompletion: 1,
              trustPassed: true,
              goalPassed: true,
            },
          },
          {
            handoff: {
              from: "expert",
              to: "verifier",
              sessionId: "session-q3",
              handoffId: "h-verifier-q3",
              parentHandoffId: "h-reviewer-q3",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "quality_verification",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 1,
              goalCompletion: 1,
              trustPassed: true,
              goalPassed: true,
            },
          },
        ],
        finalGateState: {
          trustScore: 0.95,
          goalCompletion: 1,
          trustPassed: true,
          goalPassed: true,
        },
        qualitySummary: {
          reasonCodes: [],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q3",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      result: { steps: Array<{ status: string }> };
    };
    expect(payload.contractVersion).toBe("1.1.0");
    expect(payload.result.steps.map((step) => step.status)).toEqual([
      "executed",
      "executed",
      "executed",
    ]);
    expect(payload).toMatchInlineSnapshot(`
      {
        "contractVersion": "1.1.0",
        "policy": {
          "circuitBreakerFailureThreshold": 2,
          "continueOnGoalGateFailure": false,
          "continueOnRateLimit": false,
          "continueOnStageFailure": false,
          "continueOnStageTimeout": false,
          "continueOnTrustGateFailure": false,
          "enforceGoalGate": true,
          "enforceTrustGate": true,
          "importance": 3,
          "includeReviewer": true,
          "includeTester": true,
          "includeVerifier": true,
          "maxStageRetries": 0,
          "minGoalCompletion": 1,
          "minTrustScore": 0.75,
          "rateLimitMaxExecutions": 0,
          "rateLimitWindowMs": 1000,
          "stability": 3,
          "stageTimeoutMs": 30000,
        },
        "result": {
          "finalGateState": {
            "goalCompletion": 1,
            "goalPassed": true,
            "trustPassed": true,
            "trustScore": 0.95,
          },
          "handoffs": [
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-tester-q3",
              "metadata": {
                "priority": "normal",
                "reason": "test_planning",
                "timestamp": 1,
              },
              "query": "release gate",
              "sessionId": "session-q3",
              "to": "tester",
            },
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-reviewer-q3",
              "metadata": {
                "priority": "normal",
                "reason": "code_review",
                "timestamp": 1,
              },
              "parentHandoffId": "h-tester-q3",
              "query": "release gate",
              "sessionId": "session-q3",
              "to": "reviewer",
            },
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-verifier-q3",
              "metadata": {
                "priority": "normal",
                "reason": "quality_verification",
                "timestamp": 1,
              },
              "parentHandoffId": "h-reviewer-q3",
              "query": "release gate",
              "sessionId": "session-q3",
              "to": "verifier",
            },
          ],
          "qualitySummary": {
            "dangerousPatterns": [],
            "reasonCodes": [],
            "resilience": {
              "circuitOpen": false,
              "failures": 0,
              "retries": 0,
              "timeouts": 0,
            },
          },
          "steps": [
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": true,
                "trustScore": 1,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-tester-q3",
                "metadata": {
                  "priority": "normal",
                  "reason": "test_planning",
                  "timestamp": 1,
                },
                "query": "release gate",
                "sessionId": "session-q3",
                "to": "tester",
              },
              "status": "executed",
            },
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": true,
                "trustScore": 1,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-reviewer-q3",
                "metadata": {
                  "priority": "normal",
                  "reason": "code_review",
                  "timestamp": 1,
                },
                "parentHandoffId": "h-tester-q3",
                "query": "release gate",
                "sessionId": "session-q3",
                "to": "reviewer",
              },
              "status": "executed",
            },
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": true,
                "trustScore": 1,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-verifier-q3",
                "metadata": {
                  "priority": "normal",
                  "reason": "quality_verification",
                  "timestamp": 1,
                },
                "parentHandoffId": "h-reviewer-q3",
                "query": "release gate",
                "sessionId": "session-q3",
                "to": "verifier",
              },
              "status": "executed",
            },
          ],
        },
      }
    `);
  });

  it("prints policy + result payload for goal-gate skip path", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [],
        steps: [
          {
            handoff: {
              from: "expert",
              to: "tester",
              sessionId: "session-q4",
              handoffId: "h-tester-q4",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "test_planning",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "skipped",
            gateState: {
              trustScore: 1,
              goalCompletion: 0.5,
              trustPassed: true,
              goalPassed: false,
            },
            skipReason: "goal_gate",
          },
        ],
        finalGateState: {
          trustScore: 1,
          goalCompletion: 0.5,
          trustPassed: true,
          goalPassed: false,
        },
        qualitySummary: {
          reasonCodes: ["goal_completion_below_threshold"],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q4",
      "--goal-completion",
      "0.5",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      result: { steps: Array<{ skipReason?: string }> };
    };
    expect(payload.result.steps[0]?.skipReason).toBe("goal_gate");
    expect(payload).toMatchInlineSnapshot(`
      {
        "contractVersion": "1.1.0",
        "policy": {
          "circuitBreakerFailureThreshold": 2,
          "continueOnGoalGateFailure": false,
          "continueOnRateLimit": false,
          "continueOnStageFailure": false,
          "continueOnStageTimeout": false,
          "continueOnTrustGateFailure": false,
          "enforceGoalGate": true,
          "enforceTrustGate": true,
          "importance": 3,
          "includeReviewer": true,
          "includeTester": true,
          "includeVerifier": true,
          "maxStageRetries": 0,
          "minGoalCompletion": 1,
          "minTrustScore": 0.75,
          "rateLimitMaxExecutions": 0,
          "rateLimitWindowMs": 1000,
          "stability": 3,
          "stageTimeoutMs": 30000,
        },
        "result": {
          "finalGateState": {
            "goalCompletion": 0.5,
            "goalPassed": false,
            "trustPassed": true,
            "trustScore": 1,
          },
          "handoffs": [],
          "qualitySummary": {
            "dangerousPatterns": [],
            "reasonCodes": [
              "goal_completion_below_threshold",
            ],
            "resilience": {
              "circuitOpen": false,
              "failures": 0,
              "retries": 0,
              "timeouts": 0,
            },
          },
          "steps": [
            {
              "gateState": {
                "goalCompletion": 0.5,
                "goalPassed": false,
                "trustPassed": true,
                "trustScore": 1,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-tester-q4",
                "metadata": {
                  "priority": "normal",
                  "reason": "test_planning",
                  "timestamp": 1,
                },
                "query": "release gate",
                "sessionId": "session-q4",
                "to": "tester",
              },
              "skipReason": "goal_gate",
              "status": "skipped",
            },
          ],
        },
      }
    `);
  });

  it("prints policy + result payload for stage-disabled path", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [
          {
            from: "expert",
            to: "tester",
            sessionId: "session-q5",
            handoffId: "h-tester-q5",
            attempt: 1,
            query: "release gate",
            filePaths: [],
            domains: [],
            metadata: {
              reason: "test_planning",
              priority: "normal",
              timestamp: 1,
            },
          },
        ],
        steps: [
          {
            handoff: {
              from: "expert",
              to: "tester",
              sessionId: "session-q5",
              handoffId: "h-tester-q5",
              attempt: 1,
              query: "release gate",
              filePaths: [],
              domains: [],
              metadata: {
                reason: "test_planning",
                priority: "normal",
                timestamp: 1,
              },
            },
            status: "executed",
            gateState: {
              trustScore: 1,
              goalCompletion: 1,
              trustPassed: true,
              goalPassed: true,
            },
          },
        ],
        finalGateState: {
          trustScore: 1,
          goalCompletion: 1,
          trustPassed: true,
          goalPassed: true,
        },
        qualitySummary: {
          reasonCodes: [],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q5",
      "--skip-reviewer",
      "--skip-verifier",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      policy: { includeReviewer: boolean; includeVerifier: boolean };
    };
    expect(payload.policy.includeReviewer).toBe(false);
    expect(payload.policy.includeVerifier).toBe(false);
    expect(payload).toMatchInlineSnapshot(`
      {
        "contractVersion": "1.1.0",
        "policy": {
          "circuitBreakerFailureThreshold": 2,
          "continueOnGoalGateFailure": false,
          "continueOnRateLimit": false,
          "continueOnStageFailure": false,
          "continueOnStageTimeout": false,
          "continueOnTrustGateFailure": false,
          "enforceGoalGate": true,
          "enforceTrustGate": true,
          "importance": 3,
          "includeReviewer": false,
          "includeTester": true,
          "includeVerifier": false,
          "maxStageRetries": 0,
          "minGoalCompletion": 1,
          "minTrustScore": 0.75,
          "rateLimitMaxExecutions": 0,
          "rateLimitWindowMs": 1000,
          "stability": 3,
          "stageTimeoutMs": 30000,
        },
        "result": {
          "finalGateState": {
            "goalCompletion": 1,
            "goalPassed": true,
            "trustPassed": true,
            "trustScore": 1,
          },
          "handoffs": [
            {
              "attempt": 1,
              "domains": [],
              "filePaths": [],
              "from": "expert",
              "handoffId": "h-tester-q5",
              "metadata": {
                "priority": "normal",
                "reason": "test_planning",
                "timestamp": 1,
              },
              "query": "release gate",
              "sessionId": "session-q5",
              "to": "tester",
            },
          ],
          "qualitySummary": {
            "dangerousPatterns": [],
            "reasonCodes": [],
            "resilience": {
              "circuitOpen": false,
              "failures": 0,
              "retries": 0,
              "timeouts": 0,
            },
          },
          "steps": [
            {
              "gateState": {
                "goalCompletion": 1,
                "goalPassed": true,
                "trustPassed": true,
                "trustScore": 1,
              },
              "handoff": {
                "attempt": 1,
                "domains": [],
                "filePaths": [],
                "from": "expert",
                "handoffId": "h-tester-q5",
                "metadata": {
                  "priority": "normal",
                  "reason": "test_planning",
                  "timestamp": 1,
                },
                "query": "release gate",
                "sessionId": "session-q5",
                "to": "tester",
              },
              "status": "executed",
            },
          ],
        },
      }
    `);
  });

  it("passes rate-limit options into quality execution policy", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const expert = {
      executeQualityPath: vi.fn().mockResolvedValue({
        handoffs: [],
        steps: [],
        finalGateState: {
          trustScore: 1,
          goalCompletion: 1,
          importance: 3,
          stability: 3,
          trustPassed: true,
          goalPassed: true,
        },
        qualitySummary: {
          importance: 3,
          stability: 3,
          reasonCodes: [],
          dangerousPatterns: [],
          resilience: {
            retries: 0,
            failures: 0,
            timeouts: 0,
            circuitOpen: false,
            rateLimited: 0,
          },
        },
      }),
    };

    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

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
      "agents:quality",
      "release gate",
      "--session",
      "session-q6",
      "--rate-limit-max-executions",
      "2",
      "--rate-limit-window-ms",
      "500",
      "--continue-on-rate-limit",
      "--importance",
      "4",
      "--stability",
      "5",
    ]);

    expect(expert.executeQualityPath).toHaveBeenCalledWith(
      {
        sessionId: "session-q6",
        query: "release gate",
      },
      { tester, reviewer, verifier },
      expect.objectContaining({
        rateLimitMaxExecutions: 2,
        rateLimitWindowMs: 500,
        continueOnRateLimit: true,
        importance: 4,
        stability: 5,
      }),
    );

    const payload = JSON.parse(writes.join("")) as {
      policy: {
        rateLimitMaxExecutions: number;
        rateLimitWindowMs: number;
        continueOnRateLimit: boolean;
        importance: number;
        stability: number;
      };
    };

    expect(payload.policy.rateLimitMaxExecutions).toBe(2);
    expect(payload.policy.rateLimitWindowMs).toBe(500);
    expect(payload.policy.continueOnRateLimit).toBe(true);
    expect(payload.policy.importance).toBe(4);
    expect(payload.policy.stability).toBe(5);
  });

  it.each([
    ["importance", "0"],
    ["importance", "6"],
    ["importance", "abc"],
    ["stability", "0"],
    ["stability", "6"],
    ["stability", "abc"],
  ])("rejects invalid --%s value '%s'", async (flag: string, value: string) => {
    const container = new ServiceContainer();

    const expert = {
      executeQualityPath: vi.fn(),
    };
    const tester = {} as TesterSubagent;
    const reviewer = {} as ReviewerSubagent;
    const verifier = {} as VerifierSubagent;

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => expert as unknown as ExpertOrchestrator,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () => tester,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () => reviewer,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () => verifier,
    );

    const program = createCliProgram({
      container,
      stdout: { write: () => true },
    });

    await expect(
      program.parseAsync([
        "node",
        "agent-p",
        "agents:quality",
        "release gate",
        `--${flag as "importance" | "stability"}`,
        value,
      ]),
    ).rejects.toThrow(/Expected an integer between 1 and 5/);

    expect(expert.executeQualityPath).not.toHaveBeenCalled();
  });
});

describe("CLI hooks:session-start", () => {
  it("executes session-start hook with parsed arguments", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const hook = {
      execute: vi.fn().mockReturnValue({
        hook: "session_start",
        status: "executed",
        sessionId: "session-hooks-1",
        timestamp: 100,
        query: "bootstrap",
      }),
    };

    container.registerSingleton(
      TOKENS.SessionStartHook as Token<SessionStartHook>,
      () => hook as unknown as SessionStartHook,
    );

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
      "hooks:session-start",
      "session-hooks-1",
      "--query",
      "bootstrap",
    ]);

    expect(hook.execute).toHaveBeenCalledWith(
      {
        sessionId: "session-hooks-1",
        query: "bootstrap",
      },
      {
        enabled: true,
      },
      {
        audit: {
          enabled: true,
          redactSensitive: true,
          maxPreviewChars: 2000,
        },
        platform: "neutral",
      },
    );

    const payload = JSON.parse(writes.join("")) as {
      hook: string;
      status: string;
      sessionId: string;
    };

    expect(payload.hook).toBe("session_start");
    expect(payload.status).toBe("executed");
    expect(payload.sessionId).toBe("session-hooks-1");
  });
});

describe("CLI skills commands", () => {
  it("forwards optional includeManual and limit in skills:suggest", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const activator = {
      suggest: vi.fn().mockReturnValue([]),
    };

    container.registerSingleton(
      TOKENS.SkillActivator as Token<SkillActivator>,
      () => activator as unknown as SkillActivator,
    );

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
      "skills:suggest",
      "test coverage",
      "--agent",
      "builder",
      "--domains",
      "backend",
      "--files",
      "src/cli.ts",
      "--include-manual",
      "--limit",
      "3",
    ]);

    expect(activator.suggest).toHaveBeenCalledWith({
      query: "test coverage",
      agentId: "builder",
      domains: ["backend"],
      filePaths: ["src/cli.ts"],
      includeManual: true,
      limit: 3,
    });
    expect(JSON.parse(writes.join(""))).toEqual([]);
  });

  it("loads a skill from registry in skills:load", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const skill: SkillDefinition = {
      id: "typescript-best-practices",
      name: "TypeScript Best Practices",
      description: "Type-first development and safety constraints.",
      domains: ["backend"],
      triggers: ["typescript"],
      activation: "auto",
      priority: "high",
      contextLoad: "standard",
      permissions: { allowedAgents: ["reviewer"] },
    };
    const registry = {
      get: vi.fn().mockReturnValue(skill),
    };

    container.registerSingleton(
      TOKENS.SkillRegistry as Token<SkillRegistry>,
      () => registry as unknown as SkillRegistry,
    );

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
      "skills:load",
      "typescript-best-practices",
      "--agent",
      "reviewer",
    ]);

    expect(registry.get).toHaveBeenCalledWith("typescript-best-practices");
    expect(JSON.parse(writes.join(""))).toEqual(skill);
  });

  it("keeps skills:suggest contract stable with sanitized input", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const registry = new SkillRegistry([
      {
        id: "react",
        name: "React",
        description: "React UI",
        domains: ["frontend"],
        triggers: ["react", ".tsx"],
        activation: "auto",
        priority: "medium",
        contextLoad: "minimal",
        permissions: { allowedAgents: ["builder"] },
      },
    ]);
    const activator = new SkillActivator(registry);

    container.registerSingleton(
      TOKENS.SkillActivator as Token<SkillActivator>,
      () => activator,
    );

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
      "skills:suggest",
      "\u001b[31mreact\u001b[0m component\u0007",
      "--agent",
      "builder",
      "--files",
      "src\\app\\App.tsx\u0000",
      "--limit",
      "1",
    ]);

    const payload = JSON.parse(writes.join("")) as Array<{
      skill: { id: string };
      reasons: string[];
      score: number;
    }>;

    expect(payload).toHaveLength(1);
    expect(payload[0]?.skill.id).toBe("react");
    expect(payload[0]?.reasons.length).toBeGreaterThan(0);
    expect(typeof payload[0]?.score).toBe("number");
  });

  it("rejects disallowed skill loading in skills:load", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const registry = new SkillRegistry([
      {
        id: "typescript-best-practices",
        name: "TypeScript Best Practices",
        description: "Type-first development and safety constraints.",
        domains: ["backend"],
        triggers: ["typescript"],
        activation: "auto",
        priority: "high",
        contextLoad: "standard",
        permissions: { allowedAgents: ["reviewer"] },
      },
    ]);

    container.registerSingleton(
      TOKENS.SkillRegistry as Token<SkillRegistry>,
      () => registry,
    );

    const program = createCliProgram({
      container,
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await expect(
      program.parseAsync([
        "node",
        "agent-p",
        "skills:load",
        "typescript-best-practices",
        "--agent",
        "builder",
      ]),
    ).rejects.toThrow("not allowed for agent 'builder'");
    expect(writes).toHaveLength(0);
  });
});

describe("CLI observability commands", () => {
  it("prints session stats from telemetry tracker", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const tracker = {
      summarizeSession: vi.fn().mockReturnValue({
        sessionId: "session-observe-1",
        totalEvents: 3,
        postToolUse: {
          total: 2,
          executed: 2,
          skipped: 0,
          allowed: 1,
          blocked: 1,
          averageLatencyMs: 14,
        },
        agents: {
          totalRuns: 1,
          successRuns: 1,
          failedRuns: 0,
          totalTokensIn: 200,
          totalTokensOut: 100,
          totalCostUsd: 0.0009,
        },
      }),
    };

    container.registerSingleton(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
      () => tracker as unknown as SessionMetricsTracker,
    );

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
      "stats",
      "--session",
      "session-observe-1",
    ]);

    expect(tracker.summarizeSession).toHaveBeenCalledWith("session-observe-1");
    expect(JSON.parse(writes.join("")).totalEvents).toBe(3);
  });

  it("evaluates session metrics via eval command", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const tracker = {
      summarizeSession: vi.fn().mockReturnValue({
        sessionId: "session-observe-2",
        totalEvents: 2,
        postToolUse: {
          total: 2,
          executed: 2,
          skipped: 0,
          allowed: 1,
          blocked: 1,
          averageLatencyMs: 500,
        },
        agents: {
          totalRuns: 2,
          successRuns: 1,
          failedRuns: 1,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalCostUsd: 0,
        },
      }),
    };
    const evaluator = {
      evaluate: vi.fn().mockReturnValue({
        overallScore: 0.61,
        grade: "C",
        components: {
          trustScore: 0.5,
          successRate: 0.5,
          activationAccuracy: 0.8,
          latencyScore: 0.9,
          retryPenalty: 0,
        },
        recommendations: [
          "Reduce failed handoffs before quality gate completion",
        ],
      }),
    };

    container.registerSingleton(
      TOKENS.SessionMetricsTracker as Token<SessionMetricsTracker>,
      () => tracker as unknown as SessionMetricsTracker,
    );
    container.registerSingleton(
      TOKENS.EvaluationEngine as Token<EvaluationEngine>,
      () => evaluator as unknown as EvaluationEngine,
    );

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
      "eval",
      "--session",
      "session-observe-2",
      "--activation-accuracy",
      "0.8",
    ]);

    expect(tracker.summarizeSession).toHaveBeenCalledWith("session-observe-2");
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writes.join("\n")).evaluation.grade).toBe("C");
  });
});

describe("CLI agents:workflow", () => {
  it("plans D3 workflow with explicit workflow and complexity hints", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const workflow = {
      plan: vi.fn().mockReturnValue({
        sessionId: "session-d3-1",
        query: "implement auth",
        workflowMode: "dynamic",
        effectiveWorkflowMode: "quick",
        analysisMode: "quick",
        complexity: { fileCount: 2, patternCount: 2 },
        phases: [
          {
            order: 1,
            stage: "design",
            phase: "understand",
            agent: "scout",
            objective: "Gather context and constraints",
          },
        ],
        skippedPhases: ["design", "refactor", "review"],
      }),
    };

    container.registerSingleton(
      TOKENS.D3WorkflowEngine as Token<D3WorkflowEngine>,
      () => workflow as unknown as D3WorkflowEngine,
    );

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
      "agents:workflow",
      "implement auth",
      "--session",
      "session-d3-1",
      "--workflow",
      "dynamic",
      "--mode",
      "quick",
      "--file-count",
      "2",
      "--pattern-count",
      "2",
      "--files",
      "src/auth/service.ts",
      "--domains",
      "backend",
    ]);

    expect(workflow.plan).toHaveBeenCalledWith({
      sessionId: "session-d3-1",
      query: "implement auth",
      workflowMode: "dynamic",
      analysisMode: "quick",
      filePaths: ["src/auth/service.ts"],
      domains: ["backend"],
      complexity: {
        fileCount: 2,
        patternCount: 2,
      },
    });

    const payload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      plan: { effectiveWorkflowMode: string };
    };
    expect(payload.contractVersion).toBe("1.0.0");
    expect(payload.plan.effectiveWorkflowMode).toBe("quick");
  });

  it("executes and resumes workflow with checkpoint metadata", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];
    const checkpointMap = new Map<string, D3WorkflowCheckpoint>();

    const checkpointStore: D3WorkflowCheckpointStore = {
      load: vi.fn((sessionId: string) => checkpointMap.get(sessionId)),
      save: vi.fn((checkpoint: D3WorkflowCheckpoint) => {
        checkpointMap.set(checkpoint.sessionId, checkpoint);
      }),
    };

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_800),
    );
    container.registerSingleton(
      TOKENS.D3WorkflowCheckpointStore as Token<D3WorkflowCheckpointStore>,
      () => checkpointStore,
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () =>
        ({
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        }) as unknown as ScoutSubagent,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () =>
        ({
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        }) as unknown as TesterSubagent,
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () =>
        ({
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        }) as unknown as BuilderSubagent,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () =>
        ({
          assess: vi
            .fn()
            .mockRejectedValueOnce(new Error("review failed"))
            .mockResolvedValue({ summary: "review", findings: [] }),
        }) as unknown as ReviewerSubagent,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () =>
        ({
          assess: vi.fn(async () => ({
            summary: "verify",
            trustScore: 1,
            threshold: 0.75,
            gateDecision: "pass" as const,
            checks: [],
            blockers: [],
          })),
        }) as unknown as VerifierSubagent,
    );

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
      "agents:workflow",
      "implement auth",
      "--session",
      "session-d3-2",
      "--workflow",
      "static",
      "--execute",
    ]);

    const firstPayload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      execution: {
        status: string;
        resume: { resumed: boolean };
        runtime: {
          cache: { enabled: boolean; hits: number; misses: number };
          reindex: { requested: boolean; applied: boolean };
        };
      };
    };
    expect(firstPayload.contractVersion).toBe("1.1.0");
    expect(firstPayload.execution.status).toBe("failed");
    expect(firstPayload.execution.resume.resumed).toBe(false);
    expect(firstPayload.execution.runtime.cache.enabled).toBe(true);
    expect(firstPayload.execution.runtime.cache.misses).toBeGreaterThan(0);
    expect(firstPayload.execution.runtime.reindex.requested).toBe(false);
    writes.length = 0;

    await program.parseAsync([
      "node",
      "agent-p",
      "agents:workflow",
      "--resume",
      "--session",
      "session-d3-2",
    ]);

    const resumePayload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      execution: {
        status: string;
        resume: { resumed: boolean };
        runtime: {
          cache: { enabled: boolean; hits: number; misses: number };
          reindex: { requested: boolean; applied: boolean };
        };
      };
      resume: { resumed: boolean };
    };
    expect(resumePayload.contractVersion).toBe("1.1.0");
    expect(resumePayload.execution.status).toBe("completed");
    expect(resumePayload.execution.resume.resumed).toBe(true);
    expect(resumePayload.execution.runtime.cache.hits).toBeGreaterThan(0);
    expect(resumePayload.execution.runtime.reindex.requested).toBe(false);
    expect(resumePayload.resume.resumed).toBe(true);
    expect(checkpointStore.save).toHaveBeenCalled();
    expect(checkpointStore.load).toHaveBeenCalledWith("session-d3-2");
  });

  it("wires cache and reindex CLI flags into workflow execution contract", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    container.registerSingleton(
      TOKENS.ExpertOrchestrator as Token<ExpertOrchestrator>,
      () => new ExpertOrchestrator(() => 1_700_000_000_900),
    );
    container.registerSingleton(
      TOKENS.ScoutSubagent as Token<ScoutSubagent>,
      () =>
        ({
          analyze: vi.fn(async () => ({
            summary: "scout",
            relevantFiles: ["src/auth.ts"],
            rankedFiles: [],
            domains: ["backend"],
            notes: [],
            risks: [],
          })),
        }) as unknown as ScoutSubagent,
    );
    container.registerSingleton(
      TOKENS.TesterSubagent as Token<TesterSubagent>,
      () =>
        ({
          plan: vi.fn(async () => ({
            summary: "tester",
            commands: ["pnpm test"],
            expectedChecks: ["tests"],
            failureHandling: ["logs"],
          })),
        }) as unknown as TesterSubagent,
    );
    container.registerSingleton(
      TOKENS.BuilderSubagent as Token<BuilderSubagent>,
      () =>
        ({
          plan: vi.fn(async () => ({
            summary: "builder",
            plannedChanges: ["src/auth.ts"],
            risks: [],
          })),
        }) as unknown as BuilderSubagent,
    );
    container.registerSingleton(
      TOKENS.ReviewerSubagent as Token<ReviewerSubagent>,
      () =>
        ({
          assess: vi.fn(async () => ({ summary: "review", findings: [] })),
        }) as unknown as ReviewerSubagent,
    );
    container.registerSingleton(
      TOKENS.VerifierSubagent as Token<VerifierSubagent>,
      () =>
        ({
          assess: vi.fn(async () => ({
            summary: "verify",
            trustScore: 1,
            threshold: 0.75,
            gateDecision: "pass" as const,
            checks: [],
            blockers: [],
          })),
        }) as unknown as VerifierSubagent,
    );

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
      "agents:workflow",
      "implement auth",
      "--session",
      "session-d3-flags-1",
      "--workflow",
      "quick",
      "--execute",
      "--no-cache",
      "--reindex",
    ]);

    const payload = JSON.parse(writes.join("")) as {
      contractVersion: string;
      execution: {
        runtime: {
          cache: { enabled: boolean; hits: number; misses: number };
          reindex: { requested: boolean; applied: boolean };
        };
      };
    };

    expect(payload.contractVersion).toBe("1.1.0");
    expect(payload.execution.runtime.cache.enabled).toBe(false);
    expect(payload.execution.runtime.cache.hits).toBe(0);
    expect(payload.execution.runtime.cache.misses).toBeGreaterThan(0);
    expect(payload.execution.runtime.reindex.requested).toBe(true);
    expect(payload.execution.runtime.reindex.applied).toBe(true);
  });
});

describe("CLI runtime", () => {
  it("parses argv through runCli with bootstrap defaults", async () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runCli(["node", "agent-p", "config:check"]);

    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
