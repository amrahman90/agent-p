import { describe, expect, it, vi } from "vitest";

import type {
  NotificationHook,
  PostToolUseHook,
  PreToolUseHook,
  StopHook,
} from "../../src/hooks/index.js";
import { createCliProgram } from "../../src/cli.js";
import {
  ServiceContainer,
  TOKENS,
  type Token,
} from "../../src/core/container.js";

describe("CLI phase7 hooks commands", () => {
  it("keeps hooks:config output contract stable", async () => {
    const writes: string[] = [];
    const program = createCliProgram({
      container: new ServiceContainer(),
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync(["node", "agent-p", "hooks:config"]);

    const payload = JSON.parse(writes.join(""));
    expect(payload).toMatchInlineSnapshot(`
      {
        "audit": {
          "enabled": true,
          "maxPreviewChars": 2000,
          "redactSensitive": true,
        },
        "enabled": true,
        "notification": true,
        "policy": {
          "categoryOverrides": {},
          "escalationThreshold": 0.7,
          "postToolUseDefaultDecision": "allow",
          "preToolUseDefaultDecision": "allow",
          "profile": "balanced",
          "riskyTools": [
            "bash",
            "write",
            "webfetch",
          ],
          "sensitivePatterns": [
            "api_key",
            "token",
            "password",
            "secret",
          ],
          "stopDefaultDecision": "allow",
          "strictMode": false,
          "toolOverrides": {},
        },
        "postToolUse": true,
        "preToolUse": true,
        "sessionStart": true,
        "stop": true,
      }
    `);
  });

  it("prints effective hooks config", async () => {
    const program = createCliProgram({
      container: new ServiceContainer(),
      stdout: { write: () => true },
    });

    const writes: string[] = [];
    const stdoutProgram = createCliProgram({
      container: new ServiceContainer(),
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await program.parseAsync(["node", "agent-p", "hooks:audit-log", "--clear"]);
    await stdoutProgram.parseAsync(["node", "agent-p", "hooks:config"]);

    const payload = JSON.parse(writes.join("")) as {
      policy: { strictMode: boolean };
      audit: { enabled: boolean };
    };
    expect(payload.policy.strictMode).toBe(false);
    expect(payload.audit.enabled).toBe(true);
  });

  it("maps pre-tool-use neutral result to Claude output", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const hook = {
      execute: vi.fn().mockReturnValue({
        hook: "pre_tool_use",
        status: "executed",
        sessionId: "session-hooks-2",
        timestamp: 10,
        toolName: "Bash",
        decision: "deny",
        reason: "blocked",
      }),
    };

    container.registerSingleton(
      TOKENS.PreToolUseHook as Token<PreToolUseHook>,
      () => hook as unknown as PreToolUseHook,
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
      "hooks:pre-tool-use",
      "session-hooks-2",
      "Bash",
      "--tool-input",
      '{"command":"rm -rf /tmp"}',
      "--platform",
      "claude",
    ]);

    expect(hook.execute).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writes.join("")) as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string };
    };
    expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("rejects invalid post-tool-use JSON", async () => {
    const container = new ServiceContainer();
    const hook = {
      execute: vi.fn(),
    };

    container.registerSingleton(
      TOKENS.PostToolUseHook as Token<PostToolUseHook>,
      () => hook as unknown as PostToolUseHook,
    );

    const program = createCliProgram({
      container,
      stdout: { write: () => true },
    });

    await expect(
      program.parseAsync([
        "node",
        "agent-p",
        "hooks:post-tool-use",
        "session-hooks-3",
        "Read",
        "--tool-input",
        "{bad-json}",
      ]),
    ).rejects.toThrow(/Expected valid JSON object/);

    expect(hook.execute).not.toHaveBeenCalled();
  });

  it("maps stop result to OpenCode output", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const hook = {
      execute: vi.fn().mockReturnValue({
        hook: "stop",
        status: "executed",
        sessionId: "session-hooks-4",
        timestamp: 20,
        stopHookActive: false,
        decision: "block",
        reason: "need more work",
      }),
    };

    container.registerSingleton(
      TOKENS.StopHook as Token<StopHook>,
      () => hook as unknown as StopHook,
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
      "hooks:stop",
      "session-hooks-4",
      "--platform",
      "opencode",
    ]);

    expect(hook.execute).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writes.join("")) as {
      continue: boolean;
      stopReason?: string;
    };
    expect(payload.continue).toBe(true);
    expect(payload.stopReason).toBe("need more work");
  });

  it("executes notification hook with neutral output", async () => {
    const container = new ServiceContainer();
    const writes: string[] = [];

    const hook = {
      execute: vi.fn().mockReturnValue({
        hook: "notification",
        status: "executed",
        sessionId: "session-hooks-5",
        timestamp: 30,
        notificationType: "permission_prompt",
        message: "permission required",
      }),
    };

    container.registerSingleton(
      TOKENS.NotificationHook as Token<NotificationHook>,
      () => hook as unknown as NotificationHook,
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
      "hooks:notification",
      "session-hooks-5",
      "permission_prompt",
      "permission required",
    ]);

    expect(hook.execute).toHaveBeenCalledWith(
      {
        sessionId: "session-hooks-5",
        notificationType: "permission_prompt",
        message: "permission required",
      },
      {
        enabled: true,
      },
      {
        policy: {
          profile: "balanced",
          strictMode: false,
          escalationThreshold: 0.7,
          riskyTools: ["bash", "write", "webfetch"],
          sensitivePatterns: ["api_key", "token", "password", "secret"],
          preToolUseDefaultDecision: "allow",
          postToolUseDefaultDecision: "allow",
          stopDefaultDecision: "allow",
          categoryOverrides: {},
          toolOverrides: {},
        },
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
    };
    expect(payload.hook).toBe("notification");
    expect(payload.status).toBe("executed");
  });

  it("keeps hooks:audit-log output contract stable", async () => {
    const program = createCliProgram({
      container: new ServiceContainer(),
      stdout: { write: () => true },
    });

    await program.parseAsync(["node", "agent-p", "hooks:audit-log", "--clear"]);
    await program.parseAsync([
      "node",
      "agent-p",
      "hooks:session-start",
      "session-audit-cli",
    ]);

    const writes: string[] = [];
    const readerProgram = createCliProgram({
      container: new ServiceContainer(),
      stdout: {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    });

    await readerProgram.parseAsync([
      "node",
      "agent-p",
      "hooks:audit-log",
      "--limit",
      "1",
      "--clear",
    ]);

    const payload = JSON.parse(writes.join("")) as Array<{
      hook: string;
      sessionId: string;
      platform: string;
      status: string;
      timestamp: number;
      latencyMs: number;
      payloadPreview: string;
      contextPreview: string;
    }>;

    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchInlineSnapshot(
      {
        contextPreview: expect.any(String),
        latencyMs: expect.any(Number),
        timestamp: expect.any(Number),
      },
      `
      {
        "contextPreview": Any<String>,
        "hook": "session_start",
        "latencyMs": Any<Number>,
        "payloadPreview": "{"sessionId":"session-audit-cli"}",
        "platform": "neutral",
        "sessionId": "session-audit-cli",
        "status": "executed",
        "timestamp": Any<Number>,
      }
    `,
    );

    expect(
      JSON.parse(payload[0]?.contextPreview ?? "{}") as {
        enabled: boolean;
        timestamp: number;
      },
    ).toMatchInlineSnapshot(
      {
        timestamp: expect.any(Number),
      },
      `
      {
        "enabled": true,
        "timestamp": Any<Number>,
      }
    `,
    );
  });
});
