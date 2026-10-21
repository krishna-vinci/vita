import { lstat } from "node:fs/promises";
import {
  type JobAnalysis,
  JobAnalysis as JobAnalysisSchema,
  Resume,
  Review,
  RoleUsage as RoleUsageSchema,
  Slug,
  slugify,
  visibleBullets,
} from "@vita/shared";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
import { analystRole } from "../agent/roles.js";
import { selectEvidence } from "../search/index.js";
import { generationHead } from "../sync/history.js";
import { commitPaths, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { answerClaimId, effectivePack, findGaps, loadContext, mergeKeywords, optionalText } from "./context.js";
import { answerFact, expandGroup, gapQuestion, requirementCoveredByText, requirementLabel } from "./coverage.js";
import { localDate } from "./date.js";
import { baseSummaries } from "./efficient-context.js";
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
    skip?: boolean;
  },
  deps: PipelineDeps,
) {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const profile = await loadProfile(ws.root);
    const generationSourceSha = await generationHead(ws.root);
    const date = localDate((deps.now ?? (() => new Date()))());
    if (input.slug !== undefined) Slug.parse(input.slug);
    if (input.baseId !== undefined) Slug.parse(input.baseId);
    if (input.applicationId !== undefined) Slug.parse(input.applicationId);
    const existingDir = input.applicationId ? `applications/${input.applicationId}` : undefined;
    const expectedExisting = existingDir ? await fileHash(ws.root, `${existingDir}/resume.json`) : null;
    const existingText = existingDir ? await optionalText(ws.root, `${existingDir}/resume.json`) : undefined;
    const existing = existingText ? Resume.parse(JSON.parse(existingText)) : undefined;
    const metadata = existingDir
      ? z.record(z.string(), z.unknown()).parse(parseYaml(await readText(ws.root, `${existingDir}/meta.yaml`)))
      : {};
    const notes = input.notes ?? z.string().optional().parse(metadata.notes);
    const requestedBaseId =
      input.baseId ?? existing?.parent ?? z.string().nullable().optional().parse(metadata.baseId) ?? undefined;
    const answers = { ...z.record(z.string(), z.string()).parse(metadata.answers ?? {}), ...input.answers };
    const ctx = await loadContext(
      ws,
      input.applicationId ? { answers: { applicationId: input.applicationId, answers } } : {},
    );
    try {
      const usage: RoleUsage[] = z
        .array(
          RoleUsageSchema.extend({
            role: z.enum([
              "analyst",
              "writer",
              "checker",
              "ats-reviewer",
              "resume-editor",
              "source-editor",
              "researcher",
              "interviewer",
              "template-adopter",
              "onboarder",
            ]),
          }).passthrough(),
        )
        .parse(metadata.usage ?? []);
      deps.onProgress?.({ stage: "analyse" });
      const general = await effectivePack(ctx);
      // A rerun of the same job keeps its analysis, so requirement ids (and the answers keyed by them) stay stable.
      const storedJob = existingDir ? await optionalText(ws.root, `${existingDir}/job.md`) : undefined;
      const storedAnalysis = existingDir ? await optionalText(ws.root, `${existingDir}/analysis.json`) : undefined;
      let analysis: JobAnalysis =
        storedAnalysis !== undefined && storedJob?.trim() === input.jobText.trim()
          ? JobAnalysisSchema.parse(JSON.parse(storedAnalysis))
          : await roleRunner(ctx, deps, usage, undefined, {
              applicationId: input.applicationId,
              jobNotes: notes,
            })(
              analystRole,
              [
                "Analyse the job requirements and score every supplied base. Give every requirement a short `label` (a noun phrase of at most 6 words, e.g. spreadsheet modelling or public speaking) used to ask the person whether they have done it. Return JobAnalysis through submit_analysis.",
                data("job.md", input.jobText),
                data("bases", baseSummaries(ctx.bases)),
                data("pack keywords", general.keywords),
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
      // A receipt-only or expanded-keyword hit can be too weak to write honestly.
      for (const requirement of analysis.requirements.filter((entry) => entry.importance === "must")) {
        if (gaps.some((gap) => gap.startsWith(`${requirement.id}:`))) continue;
        const predicted = selectEvidence(ctx.search, ctx.index, {
          keywords: requirement.keywords,
          lead: [],
          locked: [],
          maxClaims: 3,
        });
        if (
          !predicted.claimIds.some((id) => {
            const claim = ctx.index.claims.get(id);
            return claim && requirementCoveredByText(claim.text, requirement);
          })
        )
          gaps.push(`${requirement.id}: ${gapQuestion(requirement)}`);
      }
      for (const message of gaps) deps.onProgress?.({ stage: "gaps", message });
      // Must-haves the profile can support: tell the writer which claims cover each, so none is silently dropped.
      const gapIds = new Set(gaps.map((gap) => gap.slice(0, gap.indexOf(":"))));
      const mustCover = analysis.requirements
        .filter((requirement) => requirement.importance === "must" && !gapIds.has(requirement.id))
        .map((requirement) => ({
          requirementId: requirement.id,
          requirement: requirementLabel(requirement),
          claimIds: selectEvidence(ctx.search, ctx.index, {
            keywords: requirement.keywords.map(expandGroup),
            lead: [],
            locked: [],
            maxClaims: 3,
          }).claimIds,
        }))
        .filter((entry) => entry.claimIds.length > 0);
      deps.onProgress?.({ stage: "select" });
      const selection = selectEvidence(ctx.search, ctx.index, {
        keywords: analysis.requirements.flatMap((requirement) => requirement.keywords.map(expandGroup)),
        lead: base?.config.emphasis.lead_items ?? [],
        locked: seed ? visibleBullets(seed).filter((bullet) => bullet.locked) : [],
        maxClaims: 40,
      });
      for (const selected of selection.items) {
        const item = ctx.index.items.get(selected.itemSlug);
        if (
          !item ||
          item.meta.relationship ||
          !item.meta.links.some((link) => /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/]+\/[^/]+/i.test(link))
        )
          continue;
        const key = `ownership.${item.slug}`;
        const answer = answers[key]?.trim();
        const relationship = /^(sole|lead|team|contributor)(?:\s*:\s*([\s\S]*))?$/i.exec(answer ?? "");
        if (relationship) {
          item.meta.relationship = relationship[1]?.toLowerCase() as "sole" | "lead" | "team" | "contributor";
          if (relationship[2]) item.meta.contribution = relationship[2];
        } else gaps.push(`${key}: What was your role in ${item.name}?`);
      }
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
      const unanswered = gaps.filter((gap) => !answers[gap.slice(0, gap.indexOf(":"))]?.trim());
      // Submitting answers continues this application; remaining questions are explicitly skipped.
      const writeNow = input.skip || (input.answers !== undefined && existingDir !== undefined);
      if (writeNow) for (const gap of unanswered) answers[gap.slice(0, gap.indexOf(":"))] = "skip";
      if (unanswered.length && !writeNow && !existing) {
        const review = Review.parse({
          round: 0,
          lint: [],
          checks: [],
          ats: [],
          render: null,
          gaps,
          overrides: [],
          done: false,
          blocking: [],
        });
        const files = {
          [`${applicationDir}/job.md`]: input.jobText,
          [`${applicationDir}/analysis.json`]: `${JSON.stringify(analysis, null, 2)}\n`,
          [`${applicationDir}/review.json`]: `${JSON.stringify(review, null, 2)}\n`,
          [`${applicationDir}/meta.yaml`]: stringify({
            ...metadata,
            id,
            kind: "job",
            createdAt: metadata.createdAt ?? date,
            title: analysis.title,
            company: analysis.company,
            baseId: base?.id ?? (seed ? "master" : null),
            answers,
            notes,
            status: "needs-answers",
            usage,
          }),
        };
        deps.signal?.throwIfAborted();
        if ((await fileHash(ws.root, `${applicationDir}/resume.json`)) !== expected)
          throw new Error("Application changed during analysis");
        for (const [rel, content] of Object.entries(files)) await writeTextAtomic(ws.root, rel, content);
        await commitPaths(ws.root, Object.keys(files), `Analyse application: ${id}`, "system");
        deps.onProgress?.({ stage: "needs-answers", message: unanswered.join("\n") });
        return { applicationDir, status: "needs-answers" as const, resume: null, review, analysis };
      }
      const depthSelection = selectEvidence(ctx.search, ctx.index, {
        keywords: analysis.requirements.flatMap((requirement) => requirement.keywords.map(expandGroup)),
        lead: base?.config.emphasis.lead_items ?? [],
        locked: [],
        maxClaims: Number.MAX_SAFE_INTEGER,
      });
      const result = await generate(
        ctx,
        {
          kind: "job",
          id,
          parent: existing?.parent ?? base?.id ?? (seed ? "master" : null),
          template: existing?.template ?? base?.config.template ?? seed?.template ?? input.template ?? "rover-base",
          maxPages: base?.config.rules.max_pages ?? ctx.rules.max_pages,
          seed,
          userState: existing,
          baseConfig: base?.config,
          analysis,
          pack,
          selection,
          depthSelection,
          minFill: base?.config.rules.min_fill ?? ctx.rules.min_fill,
          gaps,
          jobText: input.jobText,
          answers,
          mustCover,
          answerClaims: input.applicationId
            ? Object.entries(answers)
                .filter(([, value]) => answerFact(value) !== null)
                .map(([requirementId]) => answerClaimId(input.applicationId as string, requirementId))
                .filter((id) => ctx.index.claims.has(id))
                .map((id) => ({ id, text: ctx.index.claims.get(id)?.text ?? "" }))
            : [],
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
          generationSourceSha,
          status: result.review.done ? "done" : "draft",
          createdAt: metadata.createdAt ?? date,
          title: analysis.title,
          company: analysis.company,
          baseId: existing?.parent ?? base?.id ?? (seed ? "master" : null),
          answers,
          notes,
        },
        existingDir ? `Rerun ${id} with answers` : undefined,
      );
      return {
        applicationDir,
        status: result.review.done ? ("done" as const) : ("draft" as const),
        resume: result.resume,
        review: result.review,
        analysis,
      };
    } finally {
      ctx.search.close();
    }
  });
}
