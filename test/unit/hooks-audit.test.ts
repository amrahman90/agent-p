import { describe, expect, it } from "vitest";

import {
  HookAuditLogger,
  InMemoryHookAuditSink,
  hookAuditConfigSchema,
} from "../../src/hooks/index.js";

describe("hook audit logging", () => {
  it("redacts sensitive fields in payload preview", () => {
    const sink = new InMemoryHookAuditSink();
    const logger = new HookAuditLogger(sink);

    logger.log({
      hook: "pre_tool_use",
      sessionId: "session-audit-1",
      platform: "neutral",
      status: "executed",
      timestamp: 10,
      latencyMs: 2,
      decision: "allow",
      payload: {
        token: "super-secret",
        nested: {
          apiKey: "another-secret",
        },
      },
      context: { enabled: true },
      config: hookAuditConfigSchema.parse({}),
    });

    const [event] = sink.snapshot();
    expect(event?.payloadPreview).toContain("[REDACTED]");
    expect(event?.payloadPreview).not.toContain("super-secret");
  });

  it("keeps only latest entries when sink limit exceeded", () => {
    const sink = new InMemoryHookAuditSink(2);
    const logger = new HookAuditLogger(sink);
    const config = hookAuditConfigSchema.parse({ enabled: true });

    logger.log({
      hook: "session_start",
      sessionId: "s1",
      platform: "neutral",
      status: "executed",
      timestamp: 1,
      latencyMs: 1,
      payload: {},
      context: {},
      config,
    });
    logger.log({
      hook: "session_start",
      sessionId: "s2",
      platform: "neutral",
      status: "executed",
      timestamp: 2,
      latencyMs: 1,
      payload: {},
      context: {},
      config,
    });
    logger.log({
      hook: "session_start",
      sessionId: "s3",
      platform: "neutral",
      status: "executed",
      timestamp: 3,
      latencyMs: 1,
      payload: {},
      context: {},
      config,
    });

    const events = sink.snapshot();
    expect(events).toHaveLength(2);
    expect(events[0]?.sessionId).toBe("s2");
    expect(events[1]?.sessionId).toBe("s3");
  });
});
