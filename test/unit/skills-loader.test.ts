import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKILLS_MANIFEST_PATH,
  DIST_SKILLS_MANIFEST_PATH,
  SkillManifestValidationError,
  SkillRegistry,
  loadSkillManifest,
  resolveSkillManifestPath,
} from "../../src/skills/index.js";

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

describe("loadSkillManifest", () => {
  it("resolves default manifest path from src location", () => {
    const path = resolveSkillManifestPath({ cwd: process.cwd() });
    expect(normalizePath(path).endsWith(DEFAULT_SKILLS_MANIFEST_PATH)).toBe(
      true,
    );
  });

  it("falls back to dist manifest path when src path does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-p-skills-dist-"));
    const distManifestPath = join(dir, DIST_SKILLS_MANIFEST_PATH);
    mkdirSync(dirname(distManifestPath), { recursive: true });
    writeFileSync(
      distManifestPath,
      JSON.stringify({ version: "0.0.1", skills: [] }),
      "utf8",
    );

    const path = resolveSkillManifestPath({ cwd: dir });
    expect(normalizePath(path).endsWith(DIST_SKILLS_MANIFEST_PATH)).toBe(true);
  });

  it("loads a valid manifest from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-p-skills-"));
    const manifestPath = join(dir, "skills.json");

    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: "0.0.1",
          skills: [
            {
              id: "typescript",
              name: "TypeScript",
              description: "TypeScript patterns",
              domains: ["backend"],
              triggers: [".ts"],
              permissions: { allowedAgents: ["builder"] },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const manifest = loadSkillManifest({ manifestPath });

    expect(manifest.version).toBe("0.0.1");
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0]?.priority).toBe("medium");
    expect(manifest.skills[0]?.activation).toBe("auto");
  });

  it("throws validation error for malformed manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-p-skills-invalid-"));
    const manifestPath = join(dir, "skills.json");

    writeFileSync(
      manifestPath,
      JSON.stringify({ version: "0.0.1", skills: [{ id: "broken" }] }),
      "utf8",
    );

    expect(() => loadSkillManifest({ manifestPath })).toThrow(
      SkillManifestValidationError,
    );
  });

  it("hydrates triggers from frontmatter and prefers it over triggers.json fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-p-skills-frontmatter-"));
    const manifestPath = join(dir, "skills.json");
    const skillDir = join(dir, "skills", "react-ui");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "triggers:",
        "  keywords:",
        '    - " React "',
        '    - "react"',
        '    - "\\u001b[31mcomponent\\u001b[0m"',
        "  filePatterns:",
        '    - "**/*.tsx"',
        "activation: manual",
        "priority: high",
        "contextLoad: standard",
        "---",
        "# React UI",
      ].join("\n"),
      "utf8",
    );

    writeFileSync(
      join(skillDir, "triggers.json"),
      JSON.stringify(
        {
          promptTriggers: {
            keywords: ["legacy-only"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: "0.0.1",
          skills: [
            {
              id: "react-ui",
              name: "React UI",
              description: "  React authoring  ",
              domains: ["frontend"],
              triggerSources: {
                frontmatterPath: "skills/react-ui/SKILL.md",
                triggersPath: "skills/react-ui/triggers.json",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const manifest = loadSkillManifest({ manifestPath });
    const skill = manifest.skills[0];

    expect(skill?.triggers).toEqual(["React", "component", "**/*.tsx"]);
    expect(skill?.activation).toBe("manual");
    expect(skill?.priority).toBe("high");
    expect(skill?.contextLoad).toBe("standard");
  });

  it("uses triggers.json fallback when frontmatter triggers are unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-p-skills-fallback-"));
    const manifestPath = join(dir, "skills.json");
    const skillDir = join(dir, "skills", "python-api");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      ["---", "name: python-api", "---", "# Python API"].join("\n"),
      "utf8",
    );

    writeFileSync(
      join(skillDir, "triggers.json"),
      JSON.stringify(
        {
          promptTriggers: {
            keywords: [" FastAPI ", "fastapi", "router"],
            intentPatterns: ["(build|create).*api"],
          },
          fileTriggers: {
            pathPatterns: ["**/*.py"],
          },
          activation: "manual",
          priority: "high",
          contextLoad: "standard",
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: "0.0.1",
          skills: [
            {
              id: "python-api",
              name: "Python API",
              description: "API service patterns",
              domains: ["backend"],
              triggerSources: {
                frontmatterPath: "skills/python-api/SKILL.md",
                triggersPath: "skills/python-api/triggers.json",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const manifest = loadSkillManifest({ manifestPath });
    const skill = manifest.skills[0];

    expect(skill?.triggers).toEqual([
      "FastAPI",
      "router",
      "(build|create).*api",
      "**/*.py",
    ]);
    expect(skill?.activation).toBe("manual");
    expect(skill?.priority).toBe("high");
    expect(skill?.contextLoad).toBe("standard");
  });
});

describe("SkillRegistry", () => {
  it("builds from manifest and filters by domain", () => {
    const registry = SkillRegistry.fromManifest({
      version: "0.0.1",
      skills: [
        {
          id: "react",
          name: "React",
          description: "React UI",
          domains: ["frontend"],
          triggers: [".tsx"],
          activation: "auto",
          priority: "medium",
          contextLoad: "minimal",
          permissions: { allowedAgents: ["scout"] },
        },
        {
          id: "node",
          name: "Node",
          description: "Node backend",
          domains: ["backend"],
          triggers: ["express"],
          activation: "manual",
          priority: "high",
          contextLoad: "standard",
          permissions: { allowedAgents: ["builder"] },
        },
      ],
    });

    expect(registry.list()).toHaveLength(2);
    expect(registry.findByDomain("frontend").map((skill) => skill.id)).toEqual([
      "react",
    ]);
    expect(registry.get("node")?.name).toBe("Node");
  });
});
