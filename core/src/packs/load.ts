import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Pack, Slug } from "@vita/shared";
import { parse } from "yaml";
import { mergePacks } from "./merge";

export async function loadPack(dirs: string[], id: string): Promise<Pack> {
  Slug.parse(id);
  for (const root of dirs) {
    let source: string;
    try {
      const canonicalRoot = await realpath(root);
      const file = await realpath(resolve(root, id, "pack.yaml"));
      const rel = relative(canonicalRoot, file);
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Pack escapes search directory");
      source = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const pack = Pack.parse(parse(source));
    if (pack.id !== id) throw new Error(`Pack id mismatch: expected ${id}, got ${pack.id}`);
    return pack;
  }
  throw new Error(`Pack not found: ${id}`);
}

export async function resolvePack(dirs: string[], id: string): Promise<Pack> {
  const chain = new Set<string>();
  async function visit(current: string): Promise<Pack> {
    if (chain.has(current)) throw new Error(`Pack extends cycle: ${[...chain, current].join(" -> ")}`);
    chain.add(current);
    const child = await loadPack(dirs, current);
    return child.extends
      ? mergePacks(await visit(child.extends), child)
      : mergePacks(Pack.parse({ id: "empty", name: "" }), child);
  }
  return visit(id);
}

export async function resolvePacks(dirs: string[], ids: string[]): Promise<Pack> {
  let effective = Pack.parse({ id: "effective", name: "Effective pack" });
  for (const id of ids) effective = mergePacks(effective, await resolvePack(dirs, id));
  const { extends: _extends, ...resolved } = effective;
  return { ...resolved, id: "effective" };
}
