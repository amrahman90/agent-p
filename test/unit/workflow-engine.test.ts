import { describe, expect, it } from "vitest";

import { D3WorkflowEngine } from "../../src/workflow/index.js";

describe("D3WorkflowEngine", () => {
  it("selects quick workflow in dynamic mode below quick threshold", () => {
    const engine = new D3WorkflowEngine({ quickThreshold: 3 });

    const plan = engine.plan({
      sessionId: "workflow-1",
      query: "add auth endpoint",
      workflowMode: "dynamic",
      complexity: { fileCount: 2, patternCount: 2 },
    });

    expect(plan.effectiveWorkflowMode).toBe("quick");
    expect(plan.phases.map((phase) => phase.phase)).toEqual([
      "understand",
      "plan",
      "implement-red",
      "build-green",
      "verify",
      "deliver",
    ]);
    expect(plan.skippedPhases).toEqual(["design", "refactor", "review"]);
  });

  it("selects static workflow in dynamic mode at threshold", () => {
    const engine = new D3WorkflowEngine({ quickThreshold: 3 });

    const plan = engine.plan({
      sessionId: "workflow-2",
      query: "large migration",
      workflowMode: "dynamic",
      complexity: { fileCount: 3, patternCount: 1 },
    });

    expect(plan.effectiveWorkflowMode).toBe("static");
    expect(plan.phases).toHaveLength(9);
    expect(plan.skippedPhases).toEqual([]);
  });

  it("auto-detects deep analysis mode when thresholds are reached", () => {
    const engine = new D3WorkflowEngine();

    const plan = engine.plan({
      sessionId: "workflow-3",
      query: "auth refactor",
      complexity: { fileCount: 15, patternCount: 1 },
    });

    expect(plan.analysisMode).toBe("deep");
  });

  it("honors static override policy when disabled", () => {
    const engine = new D3WorkflowEngine({
      defaultMode: "quick",
      staticOverride: false,
    });

    const plan = engine.plan({
      sessionId: "workflow-4",
      query: "simple fix",
      workflowMode: "static",
      complexity: { fileCount: 1, patternCount: 1 },
    });

    expect(plan.workflowMode).toBe("quick");
    expect(plan.effectiveWorkflowMode).toBe("quick");
  });

  it("enforces sequential phase transitions", () => {
    const engine = new D3WorkflowEngine();
    const plan = engine.plan({
      sessionId: "workflow-5",
      query: "implement endpoint",
      workflowMode: "quick",
      complexity: { fileCount: 2, patternCount: 2 },
    });
    const state = engine.initialState(plan);

    expect(() => engine.advanceState(state, "build-green")).toThrow(
      "Invalid phase transition",
    );

    const next = engine.advanceState(state, "plan");
    expect(next.currentPhase).toBe("plan");
    expect(next.completedPhases).toEqual(["understand"]);
  });
});
