import { describe, expect, it } from "vitest";

import { validateSkillManifest } from "../../src/skills/index.js";

describe("validateSkillManifest", () => {
  it("returns valid result for well-formed manifest", () => {
    const result = validateSkillManifest({
      version: "0.0.1",
      skills: [
        {
          id: "typescript",
          name: "TypeScript",
          description: "TypeScript patterns",
          domains: ["backend"],
          triggers: [".ts", "tsconfig"],
          activation: "auto",
          priority: "high",
          contextLoad: "minimal",
          permissions: { allowedAgents: ["expert", "builder"] },
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports duplicate ids and invalid triggers", () => {
    const result = validateSkillManifest({
      version: "0.0.1",
      skills: [
        {
          id: "typescript",
          name: "TypeScript",
          description: "TypeScript patterns",
          domains: ["backend"],
          triggers: [".ts", ".ts"],
          activation: "auto",
          priority: "high",
          contextLoad: "minimal",
          permissions: { allowedAgents: ["expert", "expert"] },
        },
        {
          id: "typescript",
          name: "TypeScript 2",
          description: "TypeScript patterns",
          domains: ["backend"],
          triggers: ["good", "bad\u0001trigger"],
          activation: "auto",
          priority: "medium",
          contextLoad: "standard",
          permissions: { allowedAgents: ["reviewer\u0001"] },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_id",
        "duplicate_trigger",
        "invalid_trigger",
        "duplicate_allowed_agent",
        "invalid_allowed_agent",
      ]),
    );
  });
});
