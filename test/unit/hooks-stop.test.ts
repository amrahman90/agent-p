import { describe, expect, it } from "vitest";

import { StopHook } from "../../src/hooks/index.js";

describe("StopHook", () => {
  it("blocks stop when completion signal is missing", () => {
    const hook = new StopHook({ now: () => 300 });

    const result = hook.execute(
      {
        sessionId: "session-stop-1",
        stopHookActive: false,
        lastAssistantMessage: "Implemented API handlers.",
      },
      {
        enabled: true,
        completionSignal: "ALL_DONE",
      },
    );

    expect(result.decision).toBe("block");
    expect(result.reasonCode).toBe("policy_block");
  });

  it("allows stop when hook is already active", () => {
    const hook = new StopHook({ now: () => 301 });

    const result = hook.execute(
      {
        sessionId: "session-stop-2",
        stopHookActive: true,
      },
      { enabled: true, completionSignal: "ALL_DONE" },
    );

    expect(result.decision).toBe("allow");
    expect(result.status).toBe("executed");
  });
});
