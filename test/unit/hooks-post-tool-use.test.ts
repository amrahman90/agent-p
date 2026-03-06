import { describe, expect, it, vi } from "vitest";

import { PostToolUseHook } from "../../src/hooks/index.js";

describe("PostToolUseHook", () => {
  it("returns block when response matches blocking pattern", () => {
    const hook = new PostToolUseHook({ now: () => 50 });

    const result = hook.execute(
      {
        sessionId: "session-post-1",
        toolName: "Write",
        toolInput: { filePath: "README.md" },
        toolResponse: { success: true, output: "contains secret token" },
      },
      {
        enabled: true,
        blockPatterns: ["secret token"],
      },
    );

    expect(result).toEqual({
      hook: "post_tool_use",
      status: "executed",
      sessionId: "session-post-1",
      timestamp: 50,
      toolName: "Write",
      decision: "block",
      reason: "Post-tool policy blocked response pattern: secret token",
      reasonCode: "policy_block",
    });
  });

  it("returns skipped when disabled", () => {
    const hook = new PostToolUseHook({ now: () => 77 });

    const result = hook.execute(
      {
        sessionId: "session-post-2",
        toolName: "Read",
        toolInput: { filePath: "src/index.ts" },
      },
      { enabled: false },
    );

    expect(result.status).toBe("skipped");
    expect(result.reasonCode).toBe("hook_disabled");
  });

  it("forwards results to telemetry and self-learning recorders", () => {
    const hook = new PostToolUseHook({ now: () => 90 });
    const telemetryRecorder = {
      recordPostToolUse: vi.fn(),
    };
    const selfLearningRecorder = {
      recordFromPostToolUse: vi.fn(),
    };

    const result = hook.execute(
      {
        sessionId: "session-post-3",
        toolName: "Read",
        toolInput: { filePath: "src/index.ts" },
      },
      { enabled: true },
      {
        telemetryRecorder,
        selfLearningRecorder,
      },
    );

    expect(result.decision).toBe("allow");
    expect(telemetryRecorder.recordPostToolUse).toHaveBeenCalledTimes(1);
    expect(selfLearningRecorder.recordFromPostToolUse).toHaveBeenCalledTimes(1);
  });
});
