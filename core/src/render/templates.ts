import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { type Resume, Slug, TemplateMeta } from "@vita/shared";
import { parse } from "yaml";

export interface LoadedTemplate {
  dir: string;
  meta: TemplateMeta;
}

export async function loadTemplate(dirs: string[], id: string): Promise<LoadedTemplate> {
  Slug.parse(id);
  for (const root of dirs) {
    const dir = resolve(root, id);
    let source: string;
    try {
      const canonicalRoot = await realpath(root);
      const canonicalFile = await realpath(resolve(dir, "template.yaml"));
      const path = relative(canonicalRoot, canonicalFile);
      if (path.startsWith("..") || isAbsolute(path)) throw new Error("Template escapes search directory");
      source = await readFile(canonicalFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const meta = TemplateMeta.parse(parse(source));
    if (meta.id !== id) throw new Error(`Template id mismatch: expected ${id}, got ${meta.id}`);
    return { dir, meta };
  }
  throw new Error(`Template not found: ${id}`);
}

export function resolveLayout(meta: TemplateMeta, layout: Resume["layout"]): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const [key, knob] of Object.entries(meta.knobs)) {
    const value = layout[key];
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    resolved[key] =
      typeof number === "number" && Number.isFinite(number)
        ? Math.min(knob.max, Math.max(knob.min, number))
        : knob.default;
  }
  return resolved;
}
