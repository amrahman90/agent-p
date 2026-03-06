import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCliCommand } from "../helpers/cli-runner.js";

const createHooksConfig = (
  profile: "strict" | "balanced" = "strict",
): string => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-p-e2e-config-"));
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
      `    profile: ${profile}`,
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

describe("CLI governance e2e smoke", () => {
  it("prints hooks config via real CLI invocation", async () => {
    // GIVEN: A strict hooks configuration file.
    const configPath = createHooksConfig("strict");

    // WHEN: Running hooks:config through the CLI entrypoint.
    const result = await runCliCommand([
      "hooks:config",
      "--config",
      configPath,
    ]);

    // THEN: Exit code is zero and policy profile is preserved.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      policy: { profile: string; strictMode: boolean };
    };
    expect(payload.policy.profile).toBe("strict");
    expect(payload.policy.strictMode).toBe(true);
  });

  it("enforces strict risky-tool escalation in pre-tool-use contract", async () => {
    // GIVEN: A strict policy config with bash marked as risky.
    const configPath = createHooksConfig("strict");

    // WHEN: Running pre-tool-use in Claude mode for bash.
    const result = await runCliCommand([
      "hooks:pre-tool-use",
      "session-e2e-smoke-1",
      "bash",
      "--tool-input",
      '{"command":"ls"}',
      "--platform",
      "claude",
      "--config",
      configPath,
    ]);

    // THEN: Contract requests permission escalation in translated output.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(payload.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("blocks sensitive output in post-tool-use contract", async () => {
    // GIVEN: A strict policy config with sensitive token patterns.
    const configPath = createHooksConfig("strict");

    // WHEN: Running post-tool-use with sensitive content.
    const result = await runCliCommand([
      "hooks:post-tool-use",
      "session-e2e-smoke-2",
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

    // THEN: OpenCode contract is blocked.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as { action: string };
    expect(payload.action).toBe("block");
  });
});
