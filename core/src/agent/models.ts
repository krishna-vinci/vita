import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { readText } from "../workspace/index.js";
import type { RoleName } from "./roles.js";

const modelName = z.string().regex(/^[^/\s]+\/\S+$/, "Expected provider/model-id");
export const ModelsConfig: z.ZodType<{ default: string; roles: Partial<Record<RoleName, string>> }> = z.object({
  default: modelName,
  roles: z
    .object({
      analyst: modelName.optional(),
      writer: modelName.optional(),
      checker: modelName.optional(),
      "ats-reviewer": modelName.optional(),
      "resume-editor": modelName.optional(),
      "source-editor": modelName.optional(),
      researcher: modelName.optional(),
      interviewer: modelName.optional(),
      "template-adopter": modelName.optional(),
      onboarder: modelName.optional(),
    })
    .strict()
    .default({}),
});
export type ModelsConfig = z.infer<typeof ModelsConfig>;

export async function loadModelsConfig(root: string): Promise<ModelsConfig> {
  return ModelsConfig.parse(parseYaml(await readText(root, "config/models.yaml")));
}

export function resolveRoleModel(cfg: ModelsConfig, role: RoleName): string {
  return cfg.roles[role] ?? cfg.default;
}

export function modelWarnings(cfg: ModelsConfig): string[] {
  const writer = resolveRoleModel(cfg, "writer");
  return resolveRoleModel(cfg, "checker") === writer
    ? [`Checker and writer use the same model (${writer}); principle 6 requires a different checker model.`]
    : [];
}
