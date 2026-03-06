import { z } from "zod";

const skillPrioritySchema = z.enum(["low", "medium", "high"]);
const skillActivationSchema = z.enum(["auto", "manual"]);
const contextLoadSchema = z.enum(["minimal", "standard", "full"]);

const triggerSchema = z.string().trim().min(1);
const domainSchema = z.string().trim().min(1);
const agentIdSchema = z.string().trim().min(1);

const skillPermissionsSchema = z.object({
  allowedAgents: z.array(agentIdSchema).min(1).optional(),
});

export const skillDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  domains: z.array(domainSchema).min(1),
  triggers: z.array(triggerSchema).min(1),
  activation: skillActivationSchema.default("auto"),
  priority: skillPrioritySchema.default("medium"),
  contextLoad: contextLoadSchema.default("minimal"),
  permissions: skillPermissionsSchema.default({}),
});

export const skillManifestSchema = z.object({
  version: z.string().trim().min(1),
  skills: z.array(skillDefinitionSchema),
});

export type SkillDefinition = z.output<typeof skillDefinitionSchema>;
export type SkillManifest = z.output<typeof skillManifestSchema>;
export type SkillPriority = z.output<typeof skillPrioritySchema>;
export type SkillActivation = z.output<typeof skillActivationSchema>;
export type SkillContextLoad = z.output<typeof contextLoadSchema>;
export type SkillPermissions = z.output<typeof skillPermissionsSchema>;
