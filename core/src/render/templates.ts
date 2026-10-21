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

export function resolveLayout(meta: TemplateMeta, layout: Resume["layout"]): Resume["layout"] {
  const resolved: Resume["layout"] = {};
  for (const [key, knob] of Object.entries(meta.knobs)) {
    const value = layout[key];
    if (knob.type === "enum") {
      if (value !== undefined && (typeof value !== "string" || !knob.options.includes(value)))
        throw new Error(`Invalid layout option: ${key}`);
      resolved[key] = value ?? knob.default;
    } else if (knob.type === "color") {
      const color = value ?? knob.default;
      if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))
        throw new Error(`Invalid layout colour: ${key}; expected #RRGGBB`);
      resolved[key] = color;
    } else if (knob.type === "bool") {
      if (value !== undefined && typeof value !== "boolean") throw new Error(`Invalid layout boolean: ${key}`);
      resolved[key] = value ?? knob.default;
    } else {
      const number = typeof value === "string" && value.trim() ? Number(value) : value;
      resolved[key] =
        typeof number === "number" && Number.isFinite(number)
          ? Math.min(knob.max, Math.max(knob.min, number))
          : knob.default;
    }
  }
  return resolved;
}
