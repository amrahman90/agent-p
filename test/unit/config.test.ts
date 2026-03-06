import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  loadConfig,
} from "../../src/config/load-config.js";

describe("loadConfig", () => {
  it("uses defaults when config file does not exist", () => {
    const config = loadConfig(".agent-p/does-not-exist.yaml");

    expect(config.version).toBe("0.0.1");
    expect(config.workflow.default).toBe("dynamic");
    expect(config.memory.hot.maxEntries).toBe(1000);
    expect(config.hooks.policy.preToolUseDefaultDecision).toBe("allow");
    expect(config.hooks.audit.maxPreviewChars).toBe(2000);
  });

  it("loads and validates a custom config file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-p-"));
    const configPath = join(tempDir, "config.yaml");

    writeFileSync(
      configPath,
      [
        'version: "0.0.1"',
        "workflow:",
        "  default: quick",
        "  quick_threshold: 5",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig(configPath);

    expect(config.workflow.default).toBe("quick");
    expect(config.workflow.quick_threshold).toBe(5);
  });

  it("throws ConfigValidationError for invalid yaml values", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-p-invalid-"));
    const configPath = join(tempDir, "config.yaml");

    writeFileSync(
      configPath,
      ["workflow:", "  quick_threshold: bad-value"].join("\n"),
      "utf8",
    );

    expect(() => loadConfig(configPath)).toThrow(ConfigValidationError);
  });

  it("fails fast on contradictory hook policy settings", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-p-hooks-policy-"));
    const configPath = join(tempDir, "config.yaml");

    writeFileSync(
      configPath,
      [
        "hooks:",
        "  enabled: true",
        "  policy:",
        "    strictMode: true",
        "    preToolUseDefaultDecision: allow",
      ].join("\n"),
      "utf8",
    );

    expect(() => loadConfig(configPath)).toThrow(ConfigValidationError);
  });

  it("migrates legacy strictMode policy into strict profile", () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "agent-p-hooks-policy-migrate-"),
    );
    const configPath = join(tempDir, "config.yaml");

    writeFileSync(
      configPath,
      [
        "hooks:",
        "  enabled: true",
        "  policy:",
        "    strictMode: true",
        "    preToolUseDefaultDecision: escalate",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig(configPath);
    expect(config.hooks.policy.strictMode).toBe(true);
    expect(config.hooks.policy.profile).toBe("strict");
  });

  it("backfills strictMode from profile-based policy config", () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "agent-p-hooks-policy-profile-"),
    );
    const configPath = join(tempDir, "config.yaml");

    writeFileSync(
      configPath,
      ["hooks:", "  enabled: true", "  policy:", "    profile: strict"].join(
        "\n",
      ),
      "utf8",
    );

    const config = loadConfig(configPath);
    expect(config.hooks.policy.profile).toBe("strict");
    expect(config.hooks.policy.strictMode).toBe(true);
    expect(config.hooks.policy.preToolUseDefaultDecision).toBe("escalate");
  });
});
