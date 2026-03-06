import { describe, expect, it } from "vitest";

import {
  SkillActivator,
  SkillRegistry,
  suggestSkills,
} from "../../src/skills/index.js";

const registry = new SkillRegistry([
  {
    id: "typescript",
    name: "TypeScript",
    description: "TypeScript patterns",
    domains: ["frontend", "backend"],
    triggers: [".ts", "tsconfig", "typescript"],
    activation: "auto",
    priority: "high",
    contextLoad: "minimal",
    permissions: { allowedAgents: ["builder", "reviewer"] },
  },
  {
    id: "react",
    name: "React",
    description: "React UI",
    domains: ["frontend"],
    triggers: [".tsx", "react", "component"],
    activation: "auto",
    priority: "medium",
    contextLoad: "minimal",
    permissions: { allowedAgents: ["scout", "builder"] },
  },
  {
    id: "nodejs-backend",
    name: "Node.js Backend",
    description: "Node API",
    domains: ["backend"],
    triggers: ["express", "fastify"],
    activation: "manual",
    priority: "medium",
    contextLoad: "standard",
    permissions: { allowedAgents: ["expert", "builder"] },
  },
  {
    id: "nestjs",
    name: "NestJS",
    description: "NestJS service and module architecture",
    domains: ["backend"],
    triggers: ["*.controller.ts", "nestjs"],
    activation: "auto",
    priority: "medium",
    contextLoad: "minimal",
    permissions: { allowedAgents: ["scout", "builder"] },
  },
]);

describe("suggestSkills", () => {
  it("matches auto skills using trigger and domain signals", () => {
    const suggestions = suggestSkills(registry, {
      query: "fix this react component with typescript and tsconfig",
      filePaths: ["src/app/App.tsx"],
      domains: ["frontend"],
      agentId: "builder",
    });

    expect(suggestions.map((entry) => entry.skill.id)).toEqual([
      "react",
      "typescript",
    ]);
    expect(suggestions[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("includes manual skills only when includeManual is enabled", () => {
    const withoutManual = suggestSkills(registry, {
      query: "build express api routes",
      domains: ["backend"],
      agentId: "builder",
    });
    const withManual = suggestSkills(registry, {
      query: "build express api routes",
      domains: ["backend"],
      includeManual: true,
      agentId: "builder",
    });

    expect(
      withoutManual.find((entry) => entry.skill.id === "nodejs-backend"),
    ).toBe(undefined);
    expect(
      withManual.find((entry) => entry.skill.id === "nodejs-backend"),
    ).toBeTruthy();
  });

  it("matches wildcard file triggers for path-based activation", () => {
    const suggestions = suggestSkills(registry, {
      query: "controller cleanup",
      filePaths: ["src/users/users.controller.ts"],
      domains: ["backend"],
      agentId: "scout",
    });

    expect(suggestions.map((entry) => entry.skill.id)).toContain("nestjs");
  });

  it("filters skills by agent allowlist deterministically", () => {
    const builderSuggestions = suggestSkills(registry, {
      query: "react component",
      filePaths: ["src/app/App.tsx"],
      agentId: "builder",
    });
    const verifierSuggestions = suggestSkills(registry, {
      query: "react component",
      filePaths: ["src/app/App.tsx"],
      agentId: "verifier",
    });

    expect(builderSuggestions.map((entry) => entry.skill.id)).toContain(
      "react",
    );
    expect(verifierSuggestions).toHaveLength(0);
  });

  it("sanitizes query and file path input before trigger matching", () => {
    const suggestions = suggestSkills(registry, {
      query: "\u001b[31mreact\u001b[0m component\u0007",
      filePaths: ["src\\app\\App.tsx\u0000"],
      agentId: "builder",
    });

    expect(suggestions.map((entry) => entry.skill.id)).toContain("react");
  });
});

describe("SkillActivator", () => {
  it("returns activated skills based on suggestions", () => {
    const activator = new SkillActivator(registry);
    const active = activator.activate({
      query: "typescript component",
      filePaths: ["src/a.ts"],
      agentId: "builder",
    });

    expect(active.map((skill) => skill.id)).toEqual(["typescript", "react"]);
  });
});
