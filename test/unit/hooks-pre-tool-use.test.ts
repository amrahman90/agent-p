import { describe, expect, it } from "vitest";

import { PreToolUseHook } from "../../src/hooks/index.js";

describe("PreToolUseHook", () => {
  it("returns deny when enforce mode matches blocked pattern", () => {
    const hook = new PreToolUseHook({ now: () => 123 });

    const result = hook.execute(
      {
        sessionId: "session-pre-1",
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/build" },
        toolUseId: "tool-1",
      },
      {
        enabled: true,
        mode: "enforce",
        blockedPatterns: ["rm -rf"],
      },
    );

    expect(result).toEqual({
      hook: "pre_tool_use",
      status: "executed",
      sessionId: "session-pre-1",
      timestamp: 123,
      toolName: "Bash",
      decision: "deny",
      reason: "Blocked by policy pattern: rm -rf",
      reasonCode: "policy_block",
      toolUseId: "tool-1",
    });
  });

  it("returns allow with dry-run context for blocked pattern", () => {
    const hook = new PreToolUseHook({ now: () => 456 });

    const result = hook.execute(
      {
        sessionId: "session-pre-2",
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/build" },
      },
      {
        enabled: true,
        mode: "dry-run",
        blockedPatterns: ["rm -rf"],
      },
    );

    expect(result.decision).toBe("allow");
    expect(result.reasonCode).toBe("no_action");
    expect(result.contextAdditions).toContain("Dry-run: would block");
  });

  it("returns skipped when disabled", () => {
    const hook = new PreToolUseHook({ now: () => 9 });

    const result = hook.execute(
      {
        sessionId: "session-pre-3",
        toolName: "Read",
        toolInput: { filePath: "src/cli.ts" },
      },
      { enabled: false },
    );

    expect(result.status).toBe("skipped");
    expect(result.reasonCode).toBe("hook_disabled");
  });
});
