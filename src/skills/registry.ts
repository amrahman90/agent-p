import { type SkillDefinition, type SkillManifest } from "./schema.js";

export class SkillRegistry {
  private readonly skillsById = new Map<string, SkillDefinition>();

  constructor(skills: readonly SkillDefinition[] = []) {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  register(skill: SkillDefinition): void {
    if (this.skillsById.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }

    this.skillsById.set(skill.id, skill);
  }

  has(skillId: string): boolean {
    return this.skillsById.has(skillId);
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.skillsById.get(skillId);
  }

  list(): SkillDefinition[] {
    return Array.from(this.skillsById.values());
  }

  findByDomain(domain: string): SkillDefinition[] {
    return this.list().filter((skill) => skill.domains.includes(domain));
  }

  static fromManifest(manifest: SkillManifest): SkillRegistry {
    return new SkillRegistry(manifest.skills);
  }
}
