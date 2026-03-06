import { describe, expect, it } from "vitest";

import { SessionStartHook } from "../../src/hooks/index.js";

describe("SessionStartHook", () => {
  it("returns executed result when enabled", () => {
    const hook = new SessionStartHook({ now: () => 1234 });

    const result = hook.execute(
      {
        sessionId: "session-1",
        query: "implement auth",
      },
      { enabled: true },
    );

    expect(result).toEqual({
      hook: "session_start",
      status: "executed",
      sessionId: "session-1",
      timestamp: 1234,
      query: "implement auth",
    });
  });

  it("returns skipped result with deterministic reason when disabled", () => {
    const hook = new SessionStartHook({ now: () => 99 });

    const result = hook.execute(
      {
        sessionId: "session-2",
      },
      { enabled: false },
    );

    expect(result).toEqual({
      hook: "session_start",
      status: "skipped",
      sessionId: "session-2",
      timestamp: 99,
      reason: "hook_disabled",
      reasonCode: "hook_disabled",
    });
  });

  it("rejects invalid session id", () => {
    const hook = new SessionStartHook({ now: () => 1 });

    expect(() =>
      hook.execute({
        sessionId: "invalid session",
      }),
    ).toThrow();
  });
});
