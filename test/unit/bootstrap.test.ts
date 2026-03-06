import { describe, expect, it, vi, afterEach } from "vitest";

import type { SkillManifest } from "../../src/skills/index.js";

const validManifest: SkillManifest = {
  version: "0.0.1",
  skills: [
    {
      id: "typescript",
      name: "TypeScript",
      description: "TypeScript patterns",
      domains: ["backend"],
      triggers: ["typescript"],
      activation: "auto",
      priority: "high",
      contextLoad: "minimal",
      permissions: { allowedAgents: ["expert"] },
    },
  ],
};

describe("bootstrapContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../../src/skills/index.js");
  });

  it("throws a validation error with all issue messages", async () => {
    vi.doMock("../../src/skills/index.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/skills/index.js")
      >("../../src/skills/index.js");
      return {
        ...actual,
        validateSkillManifest: vi.fn(() => ({
          valid: false,
          errors: [{ message: "invalid one" }, { message: "invalid two" }],
        })),
      };
    });

    const { bootstrapContainer } = await import("../../src/core/bootstrap.js");

    expect(() => bootstrapContainer({ manifest: validManifest })).toThrow(
      "Skill manifest validation failed: invalid one; invalid two",
    );
  });

  it("loads manifest with explicit cwd and manifestPath", async () => {
    const loadSkillManifest = vi.fn(() => validManifest);

    vi.doMock("../../src/skills/index.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/skills/index.js")
      >("../../src/skills/index.js");
      return {
        ...actual,
        loadSkillManifest,
        validateSkillManifest: vi.fn(() => ({ valid: true, errors: [] })),
      };
    });

    const { bootstrapContainer } = await import("../../src/core/bootstrap.js");

    bootstrapContainer({ cwd: "C:/workspace", manifestPath: "skills.json" });

    expect(loadSkillManifest).toHaveBeenCalledWith({
      cwd: "C:/workspace",
      manifestPath: "skills.json",
    });
  });

  it("loads manifest without optional loader arguments by default", async () => {
    const loadSkillManifest = vi.fn(() => validManifest);

    vi.doMock("../../src/skills/index.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/skills/index.js")
      >("../../src/skills/index.js");
      return {
        ...actual,
        loadSkillManifest,
        validateSkillManifest: vi.fn(() => ({ valid: true, errors: [] })),
      };
    });

    const { bootstrapContainer } = await import("../../src/core/bootstrap.js");

    bootstrapContainer();

    expect(loadSkillManifest).toHaveBeenCalledWith({});
  });
});
