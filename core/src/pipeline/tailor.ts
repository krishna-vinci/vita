import { lstat } from "node:fs/promises";
import { type JobAnalysis, type Resume, type Review, Slug, slugify, visibleBullets } from "@vita/shared";
import { analystRole } from "../agent/roles.js";
import { selectEvidence } from "../search/index.js";
import { fileHash, resolveInWorkspace } from "../workspace/index.js";
import { effectivePack, findGaps, loadContext, mergeKeywords } from "./context.js";
import { data, generate, roleRunner } from "./generate.js";
import { withGenerationLock } from "./lock.js";
import { persist } from "./persist.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function tailor(
  ws: WorkspaceHandle,
  input: { jobText: string; slug?: string; baseId?: string; answers?: Record<string, string> },
  deps: PipelineDeps,
): Promise<{ applicationDir: string; resume: Resume; review: Review; analysis: JobAnalysis }> {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    if (input.slug !== undefined) Slug.parse(input.slug);
    if (input.baseId !== undefined) Slug.parse(input.baseId);
    const ctx = await loadContext(ws);
    try {
      const usage: RoleUsage[] = [];
      deps.onProgress?.({ stage: "analyse" });
      const general = await effectivePack(ctx);
      let analysis: JobAnalysis = await roleRunner(
        ctx,
        deps,
        usage,
      )(
        analystRole,
        [
          "Analyse the job requirements and score every supplied base. Return JobAnalysis through submit_analysis.",
          data("job.md", input.jobText),
          data("outline.md", ctx.outlineText),
          data("projects.md", ctx.projectsText),
          data("bases", ctx.bases),
          data("effective pack", general),
        ].join("\n\n"),
      );
      const ranked = [...analysis.baseScores].sort((a, b) => b.score - a.score || a.baseId.localeCompare(b.baseId));
      const base =
        input.baseId && input.baseId !== "master"
          ? ctx.bases.find((entry) => entry.id === input.baseId)
          : input.baseId === "master"
            ? undefined
            : ranked.flatMap((score) => ctx.bases.find((entry) => entry.id === score.baseId) ?? [])[0];
      if (input.baseId && input.baseId !== "master" && !base) throw new Error(`Base not found: ${input.baseId}`);
      if (input.baseId === "master" && !ctx.master) throw new Error("Master resume not found");
      const seed = base?.resume ?? ctx.master;
      const pack = await effectivePack(ctx, base);
      analysis = {
        ...analysis,
        requirements: analysis.requirements.map((requirement) => ({
          ...requirement,
          keywords: mergeKeywords(requirement.keywords, pack),
        })),
      };
      deps.onProgress?.({ stage: "gaps" });
      const gaps = findGaps(ctx, analysis);
      for (const message of gaps) deps.onProgress?.({ stage: "gaps", message });
      deps.onProgress?.({ stage: "select" });
      const selection = selectEvidence(ctx.search, ctx.index, {
        keywords: [...analysis.requirements.flatMap((requirement) => requirement.keywords), ...pack.keywords],
        lead: base?.config.emphasis.lead_items ?? [],
        locked: seed ? visibleBullets(seed).filter((bullet) => bullet.locked) : [],
        maxClaims: 40,
      });
      const slug = Slug.parse(input.slug ?? slugify([analysis.company, analysis.title].filter(Boolean).join("-")));
      const id = `${new Date().toISOString().slice(0, 10)}-${slug}`;
      const applicationDir = `applications/${id}`;
      try {
        await lstat(resolveInWorkspace(ws.root, applicationDir));
        throw new Error(`Application already exists: ${applicationDir}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const expected = await fileHash(ws.root, `${applicationDir}/resume.json`);
      const result = await generate(
        ctx,
        {
          kind: "job",
          id,
          parent: base?.id ?? (seed ? "master" : null),
          template: base?.config.template ?? seed?.template ?? "rover-base",
          maxPages: base?.config.rules.max_pages ?? ctx.rules.max_pages,
          seed,
          baseConfig: base?.config,
          analysis,
          pack,
          selection,
          gaps,
          jobText: input.jobText,
          answers: input.answers,
        },
        deps,
        usage,
      );
      await persist(
        ws,
        applicationDir,
        result,
        deps,
        usage,
        {
          [`${applicationDir}/job.md`]: input.jobText,
          [`${applicationDir}/analysis.json`]: `${JSON.stringify(analysis, null, 2)}\n`,
        },
        expected,
        {
          title: analysis.title,
          company: analysis.company,
          baseId: base?.id ?? (seed ? "master" : null),
          answers: input.answers ?? {},
        },
      );
      return { applicationDir, resume: result.resume, review: result.review, analysis };
    } finally {
      ctx.search.close();
    }
  });
}
