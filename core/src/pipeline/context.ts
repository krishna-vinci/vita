import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseConfig, type JobAnalysis, type Pack, Resume, Slug } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { buildClaimIndex, type ClaimIndex } from "../claims/index.js";
import { resolvePacks } from "../packs/index.js";
import { EvidenceSearch, selectEvidence } from "../search/index.js";
import { assignOutlineAnchors, parseOutline, parseProjects } from "../source/index.js";
import { readText, resolveInWorkspace } from "../workspace/index.js";
import type { WorkspaceHandle } from "./types.js";

export const Rules = z
  .object({
    max_pages: z.number().int().min(1).max(4).default(1),
    max_bullet_chars: z.number().int().positive().optional(),
    banned_phrases: z.array(z.string()).optional(),
    required_sections: z.array(z.string()).optional(),
    section_order: z.array(z.string()).optional(),
    date_format: z.string().optional(),
    locale: z.string().optional(),
  })
  .passthrough();

export interface Base {
  id: string;
  config: BaseConfig;
  resume: Resume;
}

export interface Context {
  ws: WorkspaceHandle;
  outlineText: string;
  projectsText: string;
  index: ClaimIndex;
  search: EvidenceSearch;
  rules: z.infer<typeof Rules>;
  bases: Base[];
  master: Resume | undefined;
}

export async function optionalText(root: string, rel: string): Promise<string | undefined> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadContext(ws: WorkspaceHandle): Promise<Context> {
  const [outlineText, projectsText, ruleText, masterText] = await Promise.all([
    readText(ws.root, "outline.md"),
    readText(ws.root, "projects.md"),
    optionalText(ws.root, "config/rules.yaml"),
    optionalText(ws.root, "resumes/master/resume.json"),
  ]);
  const outline = parseOutline(assignOutlineAnchors(outlineText).markdown);
  const index = buildClaimIndex(parseProjects(projectsText).doc, outline);
  const bases: Base[] = [];
  let dirs: string[] = [];
  try {
    dirs = await readdir(resolveInWorkspace(ws.root, "resumes"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const id of dirs.sort()) {
    if (id === "master" || !Slug.safeParse(id).success) continue;
    const config = await optionalText(ws.root, `resumes/${id}/base.yaml`);
    if (config === undefined) continue;
    bases.push({
      id,
      config: BaseConfig.parse(parseYaml(config)),
      resume: Resume.parse(JSON.parse(await readText(ws.root, `resumes/${id}/resume.json`))),
    });
  }
  const rules = Rules.parse(ruleText === undefined ? {} : parseYaml(ruleText));
  const master = masterText === undefined ? undefined : Resume.parse(JSON.parse(masterText));
  return {
    ws,
    outlineText,
    projectsText,
    index,
    bases,
    search: EvidenceSearch.build(index, outline),
    rules,
    master,
  };
}

export async function effectivePack(ctx: Context, base?: Base): Promise<Pack> {
  return resolvePacks(
    [resolveInWorkspace(ctx.ws.root, "packs"), join(ctx.ws.bundledDir, "packs")],
    base?.config.packs ?? ["general"],
  );
}

export function mergeKeywords(groups: string[][], pack: Pack): string[][] {
  return groups.map((group) => {
    const merged = new Set(group);
    let changed = true;
    while (changed) {
      changed = false;
      for (const synonyms of pack.keywords) {
        if (!synonyms.some((term) => [...merged].some((value) => value.toLowerCase() === term.toLowerCase()))) continue;
        for (const term of synonyms) {
          if (!merged.has(term)) {
            merged.add(term);
            changed = true;
          }
        }
      }
    }
    return [...merged];
  });
}

export function findGaps(ctx: Context, analysis: JobAnalysis): string[] {
  return analysis.requirements
    .filter(
      (requirement) =>
        requirement.importance === "must" &&
        (requirement.keywords.length === 0 ||
          requirement.keywords.some(
            (group) =>
              selectEvidence(ctx.search, ctx.index, { keywords: [group], lead: [], locked: [], maxClaims: 1 }).claimIds
                .length === 0,
          )),
    )
    .map((requirement) => {
      const question =
        requirement.text.trim().split(/\s+/).length <= 4 ? "Have you used" : "Do you have experience with";
      return `${requirement.id}: ${question} ${requirement.text}?`;
    });
}
