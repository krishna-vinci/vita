import { lstat } from "node:fs/promises";
import { type JobAnalysis, Resume, type Review, Slug, slugify, visibleBullets } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { analystRole } from "../agent/roles.js";
import { selectEvidence } from "../search/index.js";
import { fileHash, readText, resolveInWorkspace } from "../workspace/index.js";
import { effectivePack, findGaps, loadContext, mergeKeywords } from "./context.js";
import { localDate } from "./date.js";
import { data, generate, roleRunner } from "./generate.js";
import { withGenerationLock } from "./lock.js";
import { persist } from "./persist.js";
import { loadProfile } from "./profile.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function tailor(
  ws: WorkspaceHandle,
  input: {
    jobText: string;
    slug?: string;
    baseId?: string;
    answers?: Record<string, string>;
    applicationId?: string;
    notes?: string;
    template?: string;
  },
  deps: PipelineDeps,
): Promise<{ applicationDir: string; resume: Resume; review: Review; analysis: JobAnalysis }> {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const profile = await loadProfile(ws.root);
    const date = localDate((deps.now ?? (() => new Date()))());
    if (input.slug !== undefined) Slug.parse(input.slug);
    if (input.baseId !== undefined) Slug.parse(input.baseId);
    if (input.applicationId !== undefined) Slug.parse(input.applicationId);
    const existingDir = input.applicationId ? `applications/${input.applicationId}` : undefined;
    const expectedExisting = existingDir ? await fileHash(ws.root, `${existingDir}/resume.json`) : null;
    const existing = existingDir
      ? Resume.parse(JSON.parse(await readText(ws.root, `${existingDir}/resume.json`)))
      : undefined;
    const metadata = existingDir
      ? z.record(z.string(), z.unknown()).parse(parseYaml(await readText(ws.root, `${existingDir}/meta.yaml`)))
      : {};
    const notes = input.notes ?? z.string().optional().parse(metadata.notes);
    const requestedBaseId = input.baseId ?? existing?.parent ?? undefined;
    const answers = { ...z.record(z.string(), z.string()).parse(metadata.answers ?? {}), ...input.answers };
    const ctx = await loadContext(ws);
    try {
      const usage: RoleUsage[] = [];
      deps.onProgress?.({ stage: "analyse" });
      const general = await effectivePack(ctx);
      let analysis: JobAnalysis = await roleRunner(ctx, deps, usage, undefined, {
        applicationId: input.applicationId,
        jobNotes: notes,
      })(
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
        requestedBaseId && requestedBaseId !== "master"
          ? ctx.bases.find((entry) => entry.id === requestedBaseId)
          : requestedBaseId === "master"
            ? undefined
            : ranked.flatMap((score) => ctx.bases.find((entry) => entry.id === score.baseId) ?? [])[0];
      if (requestedBaseId && requestedBaseId !== "master" && !base)
        throw new Error(`Base not found: ${requestedBaseId}`);
      if (requestedBaseId === "master" && !ctx.master) throw new Error("Master resume not found");
      const seed = existing ? structuredClone(existing) : (base?.resume ?? ctx.master);
      if (existing && seed) {
        for (const section of seed.sections)
          for (const item of section.items)
            for (const bullet of item.bullets) if (bullet.origin === "user") bullet.locked = true;
      }
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
      const id = input.applicationId ?? `${date}-${slug}`;
      const applicationDir = `applications/${id}`;
      if (!existingDir)
        try {
          await lstat(resolveInWorkspace(ws.root, applicationDir));
          throw new Error(`Application already exists: ${applicationDir}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      const expected = existingDir ? expectedExisting : await fileHash(ws.root, `${applicationDir}/resume.json`);
      const result = await generate(
        ctx,
        {
          kind: "job",
          id,
          parent: existing?.parent ?? base?.id ?? (seed ? "master" : null),
          template: existing?.template ?? base?.config.template ?? seed?.template ?? input.template ?? "rover-base",
          maxPages: base?.config.rules.max_pages ?? ctx.rules.max_pages,
          seed,
          baseConfig: base?.config,
          analysis,
          pack,
          selection,
          gaps,
          jobText: input.jobText,
          answers,
          notes,
        },
        deps,
        usage,
        profile,
      );
      await persist(
        ws,
        applicationDir,
        result,
        deps,
        usage,
        {
          [`${applicationDir}/job.md`]: input.jobText,
          ...(notes === undefined ? {} : { [`${applicationDir}/notes.md`]: notes }),
          [`${applicationDir}/analysis.json`]: `${JSON.stringify(analysis, null, 2)}\n`,
        },
        expected,
        {
          ...metadata,
          createdAt: metadata.createdAt ?? date,
          title: analysis.title,
          company: analysis.company,
          baseId: existing?.parent ?? base?.id ?? (seed ? "master" : null),
          answers,
          notes,
        },
        existingDir ? `Rerun ${id} with answers` : undefined,
      );
      return { applicationDir, resume: result.resume, review: result.review, analysis };
    } finally {
      ctx.search.close();
    }
  });
}
