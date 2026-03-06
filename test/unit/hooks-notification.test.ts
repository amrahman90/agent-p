import { describe, expect, it } from "vitest";

import { NotificationHook } from "../../src/hooks/index.js";

describe("NotificationHook", () => {
  it("returns executed result when enabled", () => {
    const hook = new NotificationHook({ now: () => 88 });

    const result = hook.execute(
      {
        sessionId: "session-note-1",
        notificationType: "permission_prompt",
        message: "Claude needs permission for Bash",
        title: "Permission needed",
      },
      { enabled: true },
    );

    expect(result).toEqual({
      hook: "notification",
      status: "executed",
      sessionId: "session-note-1",
      timestamp: 88,
      notificationType: "permission_prompt",
      message: "Claude needs permission for Bash",
      title: "Permission needed",
    });
  });

  it("returns skipped result when disabled", () => {
    const hook = new NotificationHook({ now: () => 89 });

    const result = hook.execute(
      {
        sessionId: "session-note-2",
        notificationType: "idle_prompt",
        message: "Agent is idle",
      },
      { enabled: false },
    );

    expect(result.status).toBe("skipped");
    expect(result.reasonCode).toBe("hook_disabled");
  });
});
