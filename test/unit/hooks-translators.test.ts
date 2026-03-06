import { describe, expect, it } from "vitest";

import {
  fromClaudeNotificationInput,
  fromClaudePostToolUseInput,
  fromClaudeStopInput,
  fromClaudeSessionStartInput,
  fromOpenCodeSessionCreatedEvent,
  fromOpenCodeSessionIdleEvent,
  fromOpenCodeToastEvent,
  fromOpenCodeToolAfterEvent,
  fromClaudePreToolUseInput,
  fromOpenCodeToolBeforeEvent,
  openCodeEventNameSchema,
  toClaudeNotificationOutput,
  toClaudePostToolUseOutput,
  toClaudePreToolUseOutput,
  toClaudeSessionStartOutput,
  toClaudeStopOutput,
  toOpenCodeNotificationOutput,
  toOpenCodePostToolUseOutput,
  toOpenCodePreToolUseOutput,
  toOpenCodeSessionStartOutput,
  toOpenCodeStopOutput,
} from "../../src/hooks/index.js";

describe("Hook translators", () => {
  it("maps Claude PreToolUse input to neutral payload", () => {
    const payload = fromClaudePreToolUseInput({
      session_id: "session-1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "tool-1",
    });

    expect(payload).toEqual({
      sessionId: "session-1",
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolUseId: "tool-1",
    });
  });

  it("maps OpenCode before-tool event to neutral payload", () => {
    const payload = fromOpenCodeToolBeforeEvent({
      sessionId: "session-2",
      tool: {
        name: "Read",
        input: { filePath: "src/index.ts" },
        id: "tool-2",
      },
    });

    expect(payload.sessionId).toBe("session-2");
    expect(payload.toolName).toBe("Read");
    expect(payload.toolUseId).toBe("tool-2");
  });

  it("maps neutral pre-tool deny result to Claude decision shape", () => {
    const output = toClaudePreToolUseOutput({
      hook: "pre_tool_use",
      status: "executed",
      sessionId: "session-3",
      timestamp: 1,
      toolName: "Bash",
      decision: "deny",
      reason: "blocked",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked",
      },
    });
  });

  it("returns empty output for skipped Claude pre-tool results", () => {
    const output = toClaudePreToolUseOutput({
      hook: "pre_tool_use",
      status: "skipped",
      sessionId: "session-skip",
      timestamp: 3,
      toolName: "Read",
    });

    expect(output).toEqual({});
  });

  it("maps blocked Claude post-tool result with default reason", () => {
    const output = toClaudePostToolUseOutput({
      hook: "post_tool_use",
      status: "executed",
      sessionId: "session-post",
      timestamp: 4,
      toolName: "Write",
      decision: "block",
    });

    expect(output).toEqual({
      decision: "block",
      reason: "Blocked by post-tool hook policy",
    });
  });

  it("maps Claude post-tool context additions without block decision", () => {
    const output = toClaudePostToolUseOutput({
      hook: "post_tool_use",
      status: "executed",
      sessionId: "session-post-context",
      timestamp: 7,
      toolName: "Write",
      contextAdditions: "summarize output",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "summarize output",
      },
    });
  });

  it("maps Claude stop block result with default reason", () => {
    const output = toClaudeStopOutput({
      hook: "stop",
      status: "executed",
      sessionId: "session-stop-default",
      timestamp: 8,
      stopHookActive: true,
      decision: "block",
    });

    expect(output).toEqual({
      decision: "block",
      reason: "Blocked by stop hook policy",
    });
  });

  it("maps executed Claude notification result", () => {
    const output = toClaudeNotificationOutput({
      hook: "notification",
      status: "executed",
      sessionId: "session-claude-notify",
      timestamp: 9,
      notificationType: "info",
      message: "ready",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "Notification",
        additionalContext: "Observed notification: info",
      },
    });
  });

  it("maps escalate decision to ask in OpenCode pre-tool output", () => {
    const output = toOpenCodePreToolUseOutput({
      hook: "pre_tool_use",
      status: "executed",
      sessionId: "session-open",
      timestamp: 5,
      toolName: "Bash",
      decision: "escalate",
      reason: "needs approval",
      inputPatch: { command: "npm run lint" },
      contextAdditions: "approval required",
    });

    expect(output).toEqual({
      action: "ask",
      reason: "needs approval",
      updatedInput: { command: "npm run lint" },
      additionalContext: "approval required",
    });
  });

  it("maps neutral stop block result to OpenCode continue payload", () => {
    const output = toOpenCodeStopOutput({
      hook: "stop",
      status: "executed",
      sessionId: "session-4",
      timestamp: 2,
      stopHookActive: false,
      decision: "block",
      reason: "need more work",
    });

    expect(output).toEqual({
      continue: true,
      stopReason: "need more work",
    });
  });

  it("maps skipped notification result to unobserved OpenCode output", () => {
    const output = toOpenCodeNotificationOutput({
      hook: "notification",
      status: "skipped",
      sessionId: "session-notify",
      timestamp: 6,
      notificationType: "warning",
      message: "check logs",
    });

    expect(output).toEqual({
      observed: false,
      type: "warning",
    });
  });

  it("maps executed notification result to observed OpenCode output", () => {
    const output = toOpenCodeNotificationOutput({
      hook: "notification",
      status: "executed",
      sessionId: "session-notify-exec",
      timestamp: 10,
      notificationType: "success",
      message: "done",
    });

    expect(output).toEqual({
      observed: true,
      type: "success",
    });
  });

  it("defaults stopHookActive to false for Claude stop input", () => {
    const payload = fromClaudeStopInput({
      session_id: "session-stop",
    });

    expect(payload).toEqual({
      sessionId: "session-stop",
      stopHookActive: false,
    });
  });

  it("maps Claude session start payload without prompt", () => {
    const payload = fromClaudeSessionStartInput({
      session_id: "session-start",
    });

    expect(payload).toEqual({
      sessionId: "session-start",
    });
  });

  it("maps Claude session start payload with prompt to query", () => {
    const payload = fromClaudeSessionStartInput({
      session_id: "session-start-query",
      prompt: "ship phase 9",
    });

    expect(payload).toEqual({
      sessionId: "session-start-query",
      query: "ship phase 9",
    });
  });

  it("maps Claude post-tool input including response and id", () => {
    const payload = fromClaudePostToolUseInput({
      session_id: "session-post-in",
      tool_name: "Read",
      tool_input: { filePath: "src/index.ts" },
      tool_response: { ok: true },
      tool_use_id: "tool-post-1",
    });

    expect(payload).toEqual({
      sessionId: "session-post-in",
      toolName: "Read",
      toolInput: { filePath: "src/index.ts" },
      toolResponse: { ok: true },
      toolUseId: "tool-post-1",
    });
  });

  it("maps Claude post-tool input without optional response/id", () => {
    const payload = fromClaudePostToolUseInput({
      session_id: "session-post-min",
      tool_name: "Read",
      tool_input: { filePath: "src/main.ts" },
    });

    expect(payload).toEqual({
      sessionId: "session-post-min",
      toolName: "Read",
      toolInput: { filePath: "src/main.ts" },
    });
  });

  it("maps Claude pre-tool input without optional tool id", () => {
    const payload = fromClaudePreToolUseInput({
      session_id: "session-pre-min",
      tool_name: "Read",
      tool_input: { filePath: "README.md" },
    });

    expect(payload).toEqual({
      sessionId: "session-pre-min",
      toolName: "Read",
      toolInput: { filePath: "README.md" },
    });
  });

  it("maps Claude notification input including title", () => {
    const payload = fromClaudeNotificationInput({
      session_id: "session-claude-toast",
      notification_type: "warning",
      message: "check config",
      title: "Policy",
    });

    expect(payload).toEqual({
      sessionId: "session-claude-toast",
      notificationType: "warning",
      message: "check config",
      title: "Policy",
    });
  });

  it("maps OpenCode after-tool event including output and id", () => {
    const payload = fromOpenCodeToolAfterEvent({
      sessionId: "session-after",
      tool: {
        name: "Read",
        input: { filePath: "README.md" },
        output: { text: "ok" },
        id: "tool-after-1",
      },
    });

    expect(payload).toEqual({
      sessionId: "session-after",
      toolName: "Read",
      toolInput: { filePath: "README.md" },
      toolResponse: { text: "ok" },
      toolUseId: "tool-after-1",
    });
  });

  it("maps OpenCode session idle with explicit active stop hook", () => {
    const payload = fromOpenCodeSessionIdleEvent({
      sessionId: "session-idle",
      stopHookActive: true,
      lastMessage: "done",
    });

    expect(payload).toEqual({
      sessionId: "session-idle",
      stopHookActive: true,
      lastAssistantMessage: "done",
    });
  });

  it("maps OpenCode session idle without optional fields", () => {
    const payload = fromOpenCodeSessionIdleEvent({
      sessionId: "session-idle-default",
    });

    expect(payload).toEqual({
      sessionId: "session-idle-default",
      stopHookActive: false,
    });
  });

  it("maps OpenCode toast input including title", () => {
    const payload = fromOpenCodeToastEvent({
      sessionId: "session-toast",
      type: "info",
      message: "heads up",
      title: "Notice",
    });

    expect(payload).toEqual({
      sessionId: "session-toast",
      notificationType: "info",
      message: "heads up",
      title: "Notice",
    });
  });

  it("maps OpenCode session-created event without query", () => {
    const payload = fromOpenCodeSessionCreatedEvent({
      sessionId: "session-created",
    });

    expect(payload).toEqual({
      sessionId: "session-created",
    });
  });

  it("maps OpenCode session-created event with query", () => {
    const payload = fromOpenCodeSessionCreatedEvent({
      sessionId: "session-created-query",
      query: "investigate policy",
    });

    expect(payload).toEqual({
      sessionId: "session-created-query",
      query: "investigate policy",
    });
  });

  it("maps skipped neutral session start result to disallow output", () => {
    const output = toOpenCodeSessionStartOutput({
      hook: "session_start",
      status: "skipped",
      sessionId: "session-created",
      timestamp: 11,
    });

    expect(output).toEqual({
      allow: false,
    });
  });

  it("maps executed neutral session start result with context", () => {
    const output = toOpenCodeSessionStartOutput({
      hook: "session_start",
      status: "executed",
      sessionId: "session-start-open",
      timestamp: 15,
      query: "summarize hooks",
    });

    expect(output).toEqual({
      allow: true,
      context: "summarize hooks",
    });
  });

  it("maps allow post-tool result to OpenCode allow action", () => {
    const output = toOpenCodePostToolUseOutput({
      hook: "post_tool_use",
      status: "executed",
      sessionId: "session-post-open",
      timestamp: 12,
      toolName: "Read",
    });

    expect(output).toEqual({
      action: "allow",
    });
  });

  it("maps block post-tool result to OpenCode block action", () => {
    const output = toOpenCodePostToolUseOutput({
      hook: "post_tool_use",
      status: "executed",
      sessionId: "session-post-open-block",
      timestamp: 16,
      toolName: "Write",
      decision: "block",
      reason: "sensitive write",
      contextAdditions: "review changes",
    });

    expect(output).toEqual({
      action: "block",
      reason: "sensitive write",
      additionalContext: "review changes",
    });
  });

  it("maps undefined pre-tool decision to OpenCode allow action", () => {
    const output = toOpenCodePreToolUseOutput({
      hook: "pre_tool_use",
      status: "executed",
      sessionId: "session-open-allow",
      timestamp: 13,
      toolName: "Read",
    });

    expect(output).toEqual({
      action: "allow",
    });
  });

  it("maps Claude session start result without query to empty output", () => {
    const output = toClaudeSessionStartOutput({
      hook: "session_start",
      status: "executed",
      sessionId: "session-empty",
      timestamp: 14,
    });

    expect(output).toEqual({});
  });

  it("maps Claude session start result with query", () => {
    const output = toClaudeSessionStartOutput({
      hook: "session_start",
      status: "executed",
      sessionId: "session-start-claude",
      timestamp: 17,
      query: "prepare context",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "prepare context",
      },
    });
  });

  it("maps non-block stop result to empty Claude stop output", () => {
    const output = toClaudeStopOutput({
      hook: "stop",
      status: "executed",
      sessionId: "session-stop-allow",
      timestamp: 18,
      stopHookActive: false,
    });

    expect(output).toEqual({});
  });

  it("maps skipped Claude notification result to empty output", () => {
    const output = toClaudeNotificationOutput({
      hook: "notification",
      status: "skipped",
      sessionId: "session-claude-notify-skip",
      timestamp: 19,
      notificationType: "warning",
      message: "not observed",
    });

    expect(output).toEqual({});
  });

  it("validates OpenCode event name enum", () => {
    const parsed = openCodeEventNameSchema.parse("tool.execute.before");
    expect(parsed).toBe("tool.execute.before");

    expect(() => openCodeEventNameSchema.parse("tool.unknown")).toThrow();
  });
});
