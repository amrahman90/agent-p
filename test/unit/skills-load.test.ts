import { describe, expect, it } from "vitest";

import {
  loadSkill,
  load_skill,
  SkillActivator,
  SkillRegistry,
} from "../../src/skills/index.js";

const registry = new SkillRegistry([
  {
    id: "nodejs-backend",
    name: "Node.js Backend",
    description: "Node API",
    domains: ["backend"],
    triggers: ["express", "fastify"],
    activation: "manual",
    priority: "medium",
    contextLoad: "standard",
    permissions: { allowedAgents: ["builder", "reviewer"] },
  },
]);

describe("loadSkill", () => {
  it("loads an existing skill by id", () => {
    const skill = loadSkill(registry, {
      skillId: "nodejs-backend",
      agentId: "builder",
    });

    expect(skill.id).toBe("nodejs-backend");
    expect(skill.activation).toBe("manual");
  });

  it("supports snake_case alias", () => {
    const skill = load_skill(registry, {
      skillId: "nodejs-backend",
      agentId: "builder",
    });

    expect(skill.name).toBe("Node.js Backend");
  });

  it("throws when the skill id does not exist", () => {
    expect(() => loadSkill(registry, { skillId: "missing" })).toThrow(
      "Skill not found: missing",
    );
  });

  it("throws when the skill is disallowed for agent context", () => {
    expect(() =>
      loadSkill(registry, { skillId: "nodejs-backend", agentId: "verifier" }),
    ).toThrow("not allowed for agent 'verifier'");
  });
});

describe("SkillActivator.load", () => {
  it("loads a skill through activator facade", () => {
    const activator = new SkillActivator(registry);
    const skill = activator.load({
      skillId: "nodejs-backend",
      agentId: "builder",
    });

    expect(skill.contextLoad).toBe("standard");
  });
});
