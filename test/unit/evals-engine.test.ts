import { describe, expect, it } from "vitest";

import { EvaluationEngine } from "../../src/evals/index.js";

describe("EvaluationEngine", () => {
  it("returns strong grade when trust and success metrics are high", () => {
    const engine = new EvaluationEngine();

    const result = engine.evaluate({
      trustScore: 0.95,
      successRate: 0.92,
      activationAccuracy: 0.9,
      averageLatencyMs: 220,
      retryRate: 0.02,
    });

    expect(result.grade).toBe("A");
    expect(result.overallScore).toBeGreaterThan(0.85);
    expect(result.recommendations).toEqual([]);
  });

  it("adds targeted recommendations for weak telemetry metrics", () => {
    const engine = new EvaluationEngine();

    const result = engine.evaluate({
      trustScore: 0.5,
      successRate: 0.6,
      activationAccuracy: 0.7,
      averageLatencyMs: 1800,
      retryRate: 0.35,
    });

    expect(result.grade).toBe("D");
    expect(result.recommendations).toContain(
      "Increase verifier evidence quality and rigor inputs",
    );
    expect(result.recommendations).toContain(
      "Reduce failed handoffs before quality gate completion",
    );
    expect(result.recommendations).toContain(
      "Tune skill triggers to improve activation accuracy",
    );
    expect(result.recommendations).toContain(
      "Reduce median stage latency in search/agent paths",
    );
    expect(result.recommendations).toContain(
      "Investigate retry spikes and tighten failure handling",
    );
  });
});
