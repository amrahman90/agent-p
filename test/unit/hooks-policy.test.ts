import { describe, expect, it } from "vitest";

import { HookPolicyEngine } from "../../src/hooks/index.js";

describe("HookPolicyEngine", () => {
  it("applies strict profile defaults when strictMode is omitted", () => {
    const engine = new HookPolicyEngine({
      profile: "strict",
    });

    const decision = engine.evaluatePreToolUse(
      {
        sessionId: "session-policy-profile-1",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 1,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(decision.decision).toBe("escalate");
    expect(decision.reasonCode).toBe("policy_block");
  });

  it("escalates risky pre-tool use in strict mode", () => {
    const engine = new HookPolicyEngine({
      strictMode: true,
      escalationThreshold: 0.5,
      preToolUseDefaultDecision: "escalate",
    });

    const decision = engine.evaluatePreToolUse(
      {
        sessionId: "session-policy-1",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 1,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(decision.decision).toBe("escalate");
    expect(decision.reasonCode).toBe("policy_block");
  });

  it("blocks post-tool output with sensitive pattern in strict mode", () => {
    const engine = new HookPolicyEngine({
      strictMode: true,
      preToolUseDefaultDecision: "escalate",
    });

    const decision = engine.evaluatePostToolUse(
      {
        sessionId: "session-policy-2",
        toolName: "read",
        toolInput: {},
        toolResponse: { token: "abc" },
      },
      {
        enabled: true,
        timestamp: 2,
        blockPatterns: [],
      },
    );

    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("sensitive");
  });

  it("applies configured stop default decision", () => {
    const engine = new HookPolicyEngine({
      stopDefaultDecision: "block",
    });

    const decision = engine.evaluateStop(
      {
        sessionId: "session-policy-3",
        stopHookActive: false,
      },
      {
        enabled: true,
        timestamp: 3,
      },
    );

    expect(decision.decision).toBe("block");
    expect(decision.reasonCode).toBe("policy_block");
  });

  it("honors tool-level override for risky classification", () => {
    const engine = new HookPolicyEngine({
      profile: "strict",
      preToolUseDefaultDecision: "allow",
      toolOverrides: {
        bash: {
          risky: false,
        },
      },
    });

    const decision = engine.evaluatePreToolUse(
      {
        sessionId: "session-policy-4",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 4,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(decision.decision).toBe("allow");
  });

  it("honors category-level override for strict-mode post-tool checks", () => {
    const engine = new HookPolicyEngine({
      profile: "strict",
      categoryOverrides: {
        filesystem: {
          strictMode: false,
        },
      },
    });

    const decision = engine.evaluatePostToolUse(
      {
        sessionId: "session-policy-5",
        toolName: "read",
        toolInput: {},
        toolResponse: { token: "abc" },
      },
      {
        enabled: true,
        timestamp: 5,
        blockPatterns: [],
      },
    );

    expect(decision.decision).toBe("allow");
  });

  it("applies override precedence as profile -> category -> tool", () => {
    const engine = new HookPolicyEngine({
      profile: "strict",
      categoryOverrides: {
        shell: {
          strictMode: false,
          preToolUseDefaultDecision: "deny",
        },
      },
      toolOverrides: {
        bash: {
          strictMode: true,
          risky: true,
          preToolUseDefaultDecision: "escalate",
        },
      },
    });

    const decision = engine.evaluatePreToolUse(
      {
        sessionId: "session-policy-6",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 6,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(decision.decision).toBe("escalate");
    expect(decision.reasonCode).toBe("policy_block");
  });

  it("keeps permissive profile non-risky by default unless overridden", () => {
    const withoutOverride = new HookPolicyEngine({
      profile: "permissive",
      strictMode: true,
      preToolUseDefaultDecision: "allow",
    });

    const withoutOverrideDecision = withoutOverride.evaluatePreToolUse(
      {
        sessionId: "session-policy-7",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 7,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(withoutOverrideDecision.decision).toBe("allow");

    const withOverride = new HookPolicyEngine({
      profile: "permissive",
      strictMode: true,
      preToolUseDefaultDecision: "allow",
      toolOverrides: {
        bash: {
          risky: true,
          escalationThreshold: 0.5,
        },
      },
    });

    const withOverrideDecision = withOverride.evaluatePreToolUse(
      {
        sessionId: "session-policy-8",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      {
        enabled: true,
        timestamp: 8,
        mode: "enforce",
        blockedPatterns: [],
      },
    );

    expect(withOverrideDecision.decision).toBe("escalate");
    expect(withOverrideDecision.reasonCode).toBe("policy_block");
  });
});
