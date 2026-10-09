import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Rules } from "@vita/shared";
import { BaseConfig, JobAnalysis, type Pack, Resume, Slug, slugify } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { buildClaimIndex, type ClaimIndex } from "../claims/index.js";
import { loadRules } from "../instructions/rules.js";
import { resolvePacks } from "../packs/index.js";
import { EvidenceSearch, selectEvidence } from "../search/index.js";
import { assignOutlineAnchors, parseOutline, parseProjects } from "../source/index.js";
import { readText, resolveInWorkspace } from "../workspace/index.js";
import { answerFact, expandGroup, gapQuestion, requirementLabel } from "./coverage.js";
import type { WorkspaceHandle } from "./types.js";

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
  rules: Rules;
  lockedMaxPages?: number;
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

export async function loadContext(
  ws: WorkspaceHandle,
  opts: { answers?: { applicationId: string; answers: Record<string, string> } } = {},
): Promise<Context> {
  const [outlineText, projectsText, ruleConfig, masterText] = await Promise.all([
    readText(ws.root, "outline.md"),
    readText(ws.root, "projects.md"),
    loadRules(ws),
    optionalText(ws.root, "resumes/master/resume.json"),
  ]);
  const outline = parseOutline(assignOutlineAnchors(outlineText).markdown);
  const index = buildClaimIndex(parseProjects(projectsText).doc, outline);
  await addAnswerClaims(ws, index, opts.answers);
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
  const rules = ruleConfig.rules;
  const master = masterText === undefined ? undefined : Resume.parse(JSON.parse(masterText));
  return {
    ws,
    outlineText,
    projectsText,
    index,
    bases,
    search: EvidenceSearch.build(index, outline),
    rules,
    lockedMaxPages: ruleConfig.lockedMaxPages,
    master,
  };
}

/** Claim id for a "yes" answer to a job's gap question. */
export function answerClaimId(applicationId: string, requirementId: string): string {
  return `answer.${slugify(applicationId)}.${slugify(requirementId)}`.slice(0, 80);
}

/**
 * "Yes" answers to gap questions are dated, user-attested facts (principle 3). They are indexed as claims so the
 * writer can cite them, lint can source their numbers, and reopened jobs keep resolving them.
 */
async function addAnswerClaims(
  ws: WorkspaceHandle,
  index: ClaimIndex,
  pending?: { applicationId: string; answers: Record<string, string> },
): Promise<void> {
  let apps: string[] = [];
  try {
    apps = await readdir(resolveInWorkspace(ws.root, "applications"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const app of apps.sort()) {
    if (!Slug.safeParse(app).success) continue;
    const meta = await optionalText(ws.root, `applications/${app}/meta.yaml`);
    if (meta === undefined) continue;
    const parsed = (parseYaml(meta) ?? {}) as { answers?: Record<string, unknown>; createdAt?: unknown };
    const stored = parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {};
    // Answers submitted in this request are not on disk yet.
    parsed.answers = pending?.applicationId === app ? { ...stored, ...pending.answers } : stored;
    if (Object.keys(parsed.answers).length === 0) continue;
    const analysisText = await optionalText(ws.root, `applications/${app}/analysis.json`);
    const analysis = analysisText ? JobAnalysis.safeParse(JSON.parse(analysisText)) : undefined;
    for (const [requirementId, raw] of Object.entries(parsed.answers)) {
      const fact = answerFact(String(raw));
      if (!fact) continue;
      const requirement = analysis?.success
        ? analysis.data.requirements.find((entry) => entry.id === requirementId)
        : undefined;
      const label = requirement ? requirementLabel(requirement) : requirementId.replace(/^req-/, "").replace(/-/g, " ");
      const id = answerClaimId(app, requirementId);
      const evidenceId = `ev-${id.replace(/\./g, "-")}`.slice(0, 80);
      index.claims.set(id, {
        id,
        text: fact === "Yes" ? `Experience with ${label} (stated by you)` : `${label}: ${fact}`,
        source: "outline",
        itemSlug: null,
        itemName: null,
        evidence: [
          {
            id: evidenceId,
            kind: "statement",
            text: String(raw),
            ...(typeof parsed.createdAt === "string" ? { at: parsed.createdAt } : {}),
          },
        ],
        metrics: [],
        limits: [],
      });
    }
  }
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

/**
 * A must-have is a gap only when none of its keyword groups (with distinctive words of each phrase) finds any
 * evidence. "Yes" answers count as evidence because they are indexed as claims.
 */
export function findGaps(ctx: Context, analysis: JobAnalysis): string[] {
  return analysis.requirements
    .filter(
      (requirement) =>
        requirement.importance === "must" &&
        !requirement.keywords.some(
          (group) =>
            selectEvidence(ctx.search, ctx.index, {
              keywords: [expandGroup(group)],
              lead: [],
              locked: [],
              maxClaims: 1,
            }).claimIds.length > 0,
        ),
    )
    .map((requirement) => `${requirement.id}: ${gapQuestion(requirement)}`);
}
