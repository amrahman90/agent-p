import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCliProgram } from "../../src/cli.js";
import { ServiceContainer } from "../../src/core/container.js";
import {
  JsonlHookAuditSink,
  PostToolUseHook,
  PreToolUseHook,
  SessionStartHook,
  StopHook,
} from "../../src/hooks/index.js";

const createStrictHooksConfig = (): string => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-p-hooks-governance-"));
  const configPath = join(tempDir, "config.yaml");

  writeFileSync(
    configPath,
    [
      'version: "0.0.1"',
      "hooks:",
      "  enabled: true",
      "  preToolUse: true",
      "  postToolUse: true",
      "  sessionStart: true",
      "  stop: true",
      "  notification: true",
      "  policy:",
      "    strictMode: true",
      "    escalationThreshold: 0.5",
      "    riskyTools:",
      "      - bash",
      "    sensitivePatterns:",
      "      - token",
      "      - secret",
      "    preToolUseDefaultDecision: escalate",
      "    postToolUseDefaultDecision: allow",
      "    stopDefaultDecision: allow",
      "  audit:",
      "    enabled: true",
      "    redactSensitive: true",
      "    maxPreviewChars: 500",
    ].join("\n"),
    "utf8",
  );

  return configPath;
};

describe("hooks governance integration", () => {
  it("enforces strict pre-tool escalation across platform outputs", async () => {
    const configPath = createStrictHooksConfig();
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

    await program.parseAsync([
      "node",
      "agent-p",
      "hooks:pre-tool-use",
      "session-e2e-hooks-1",
      "bash",
      "--tool-input",
      '{"command":"ls"}',
      "--platform",
      "claude",
      "--config",
      configPath,
    ]);

    const claudePayload = JSON.parse(writes.join("")) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(claudePayload.hookSpecificOutput.permissionDecision).toBe("ask");

    writes.length = 0;
    await program.parseAsync([
      "node",
      "agent-p",
      "hooks:pre-tool-use",
      "session-e2e-hooks-1",
      "bash",
      "--tool-input",
      '{"command":"ls"}',
      "--platform",
      "opencode",
      "--config",
      configPath,
    ]);

    const opencodePayload = JSON.parse(writes.join("")) as { action: string };
    expect(opencodePayload.action).toBe("ask");
  });

  it("blocks sensitive post-tool output and surfaces decision for translators", async () => {
    const configPath = createStrictHooksConfig();
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

    await program.parseAsync([
      "node",
      "agent-p",
      "hooks:post-tool-use",
      "session-e2e-hooks-2",
      "read",
      "--tool-input",
      "{}",
      "--tool-response",
      '{"value":"token exposed"}',
      "--platform",
      "claude",
      "--config",
      configPath,
    ]);

    const claudePayload = JSON.parse(writes.join("")) as {
      decision: string;
      reason?: string;
    };
    expect(claudePayload.decision).toBe("block");
    expect(claudePayload.reason).toContain("sensitive");

    writes.length = 0;
    await program.parseAsync([
      "node",
      "agent-p",
      "hooks:post-tool-use",
      "session-e2e-hooks-2",
      "read",
      "--tool-input",
      "{}",
      "--tool-response",
      '{"value":"token exposed"}',
      "--platform",
      "opencode",
      "--config",
      configPath,
    ]);

    const opencodePayload = JSON.parse(writes.join("")) as {
      action: string;
    };
    expect(opencodePayload.action).toBe("block");
  });

  it("writes ordered JSONL audit entries for full hook sequence", () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "agent-p-hooks-audit-sequence-"),
    );
    const auditLogPath = join(tempDir, "hooks-audit.jsonl");
    const auditSink = new JsonlHookAuditSink(auditLogPath);
    const auditConfig = {
      enabled: true,
      redactSensitive: true,
      maxPreviewChars: 500,
    } as const;

    const sessionStartHook = new SessionStartHook({ now: () => 100 });
    const preToolUseHook = new PreToolUseHook({ now: () => 110 });
    const postToolUseHook = new PostToolUseHook({ now: () => 120 });
    const stopHook = new StopHook({ now: () => 130 });

    sessionStartHook.execute(
      {
        sessionId: "session-e2e-hooks-sequence",
        query: "run full hook sequence",
      },
      {
        enabled: true,
      },
      {
        audit: auditConfig,
        auditSink,
        platform: "neutral",
      },
    );

    preToolUseHook.execute(
      {
        sessionId: "session-e2e-hooks-sequence",
        toolName: "read",
        toolInput: { path: "README.md" },
      },
      {
        enabled: true,
      },
      {
        audit: auditConfig,
        auditSink,
        platform: "neutral",
      },
    );

    postToolUseHook.execute(
      {
        sessionId: "session-e2e-hooks-sequence",
        toolName: "read",
        toolInput: { path: "README.md" },
        toolResponse: { content: "safe output" },
      },
      {
        enabled: true,
      },
      {
        audit: auditConfig,
        auditSink,
        platform: "neutral",
      },
    );

    stopHook.execute(
      {
        sessionId: "session-e2e-hooks-sequence",
        stopHookActive: false,
      },
      {
        enabled: true,
      },
      {
        audit: auditConfig,
        auditSink,
        platform: "neutral",
      },
    );

    const events = readFileSync(auditLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { hook: string; status: string });

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.hook)).toEqual([
      "session_start",
      "pre_tool_use",
      "post_tool_use",
      "stop",
    ]);
    expect(events.map((event) => event.status)).toEqual([
      "executed",
      "executed",
      "executed",
      "executed",
    ]);
  });
});
