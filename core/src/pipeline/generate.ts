import { join } from "node:path";
import {
  type AtsNote,
  type BaseConfig,
  type CheckNote,
  type Finding,
  type JobAnalysis,
  type Pack,
  type Profile,
  Resume,
  Review,
  visibleBullets,
} from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import {
  buildSystemPrompt,
  modelWarnings,
  RoleSession,
  type RoleSpec,
  resolveRoleModel,
  runRole,
  wrapUntrusted,
} from "../agent/index.js";
import { atsReviewerRole, checkerRole, writerRole } from "../agent/roles.js";
import { enforcePageLimit } from "../instructions/rules.js";
import { lintResume } from "../lint/index.js";
import {
  checkPatchedRender,
  compileTex,
  loadTemplate,
  pdfText,
  type RenderSources,
  renderMarkdown,
  renderStoredTex,
} from "../render/index.js";
import type { Selection } from "../search/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import type { Context } from "./context.js";
import { evaluateDone } from "./done.js";
import { checkerContext, VerdictCache, writerEvidence } from "./efficient-context.js";
import type { PipelineDeps, RoleUsage } from "./types.js";

export function data(source: string, value: unknown): string {
  return wrapUntrusted(source, typeof value === "string" ? value : JSON.stringify(value));
}

export function effectiveModels(deps: PipelineDeps): PipelineDeps["models"] {
  const models = { ...deps.models, roles: { ...deps.models.roles } };
  for (const [role, model] of Object.entries(deps.modelOverrides ?? {})) {
    if (model) models.roles[role as keyof typeof models.roles] = `${model.provider}/${model.id}`;
  }
  return models;
}

export function roleRunner(
  ctx: Context,
  deps: PipelineDeps,
  usage: RoleUsage[],
  models = effectiveModels(deps),
  guidance: {
    applicationId?: string;
    jobNotes?: string;
    baseId?: string;
    baseGuidance?: string;
    onWarning?: (message: string) => void;
  } = {},
) {
  return async <O>(
    role: RoleSpec<O>,
    task: string,
    resume?: Resume,
    analysis?: JobAnalysis,
    session?: RoleSession,
    render?: Promise<unknown>,
  ): Promise<O> => {
    deps.signal?.throwIfAborted();
    const system = await buildSystemPrompt({
      role,
      ...guidance,
      onWarning: (message) => {
        guidance.onWarning?.(message);
        deps.onProgress?.({ stage: "warning", message });
      },
      root: ctx.ws.root,
      bundledDir: ctx.ws.bundledDir,
      task: "Follow the generation task in the user message.",
    });
    return runRole({
      role,
      task,
      system,
      root: ctx.ws.root,
      tools: { root: ctx.ws.root, index: ctx.index, search: ctx.search, resume, analysis, render },
      session,
      runtime: deps.runtime,
      models,
      modelOverride: deps.modelOverrides?.[role.name],
      signal: deps.signal,
      retry: deps.retry,
      onUsage: (entry) => {
        usage.push(entry);
        deps.onUsage?.(entry);
        // Fallback safety uses the actual writer, including a rate-limit fallback.
        if (role.name === "writer" || role.name === "checker") models.roles[role.name] = entry.model;
      },
    });
  };
}

function carryUserState(draft: Resume, seed?: Resume): Resume {
  const result = structuredClone(draft);
  const original = new Map(
    seed?.sections
      .flatMap((section) => section.items.flatMap((item) => item.bullets))
      .map((bullet) => [bullet.id, bullet]) ?? [],
  );
  for (const section of result.sections) {
    for (const item of section.items) {
      // Link overrides belong to the person; models cannot supply or change them.
      const previousItem = seed?.sections.flatMap((section) => section.items).find((entry) => entry.id === item.id);
      delete item.links;
      if (previousItem?.links !== undefined) item.links = structuredClone(previousItem.links);
    }
  }
  for (const section of result.sections)
    for (const item of section.items)
      for (const bullet of item.bullets) {
        const previous = original.get(bullet.id);
        // A model cannot grant itself a user override, user origin, or a lock.
        delete bullet.override;
        bullet.origin = "ai";
        bullet.locked = false;
        if (
          previous &&
          previous.text === bullet.text &&
          JSON.stringify(previous.claims) === JSON.stringify(bullet.claims)
        ) {
          if (previous.override) bullet.override = structuredClone(previous.override);
          bullet.origin = previous.origin;
        }
      }
  for (const section of seed?.sections ?? [])
    for (const item of section.items) {
      const locked = item.bullets.filter((bullet) => bullet.locked);
      if (!locked.length) continue;
      for (const target of result.sections)
        for (const entry of target.items) {
          entry.bullets = entry.bullets.filter((bullet) => !locked.some((source) => source.id === bullet.id));
        }
      let target = result.sections.find((entry) => entry.id === section.id);
      if (!target) {
        target = { ...structuredClone(section), items: [] };
        result.sections.push(target);
      }
      target.hidden = section.hidden;
      let entry = target.items.find((value) => value.id === item.id);
      if (!entry) {
        entry = { ...structuredClone(item), bullets: [] };
        target.items.push(entry);
      }
      entry.hidden = item.hidden;
      for (const bullet of locked) {
        const position = item.bullets.findIndex((value) => value.id === bullet.id);
        entry.bullets.splice(Math.min(position, entry.bullets.length), 0, structuredClone(bullet));
      }
    }
  return Resume.parse(result);
}

export interface GenerationInput {
  kind: "master" | "base" | "job";
  id: string;
  parent: string | null;
  template: string;
  maxPages: number;
  seed?: Resume;
  baseConfig?: BaseConfig;
  analysis: JobAnalysis;
  pack: Pack;
  selection?: Selection;
  gaps: string[];
  jobText?: string;
  answers?: Record<string, string>;
  /** Must-haves with supporting claims; each needs a bullet or skill entry citing one of them. */
  mustCover?: { requirementId: string; requirement: string; claimIds: string[] }[];
  /** User-attested facts from "yes" gap answers, citable as claims. */
  answerClaims?: { id: string; text: string }[];
  direction?: string;
  notes?: string;
  baseGuidance?: string;
}

export async function generate(
  ctx: Context,
  input: GenerationInput,
  deps: PipelineDeps,
  usage: RoleUsage[],
  profile: Profile,
) {
  const header = { name: profile.name, headline: profile.headline, contact: profile.contact };
  const writer: RoleSpec<Resume> = {
    ...writerRole,
    skills: input.kind === "base" ? [...writerRole.skills, "build-base"] : writerRole.skills,
    submitTool: {
      ...writerRole.submitTool,
      parameters: Type.Unsafe(z.toJSONSchema(z.object(Resume.shape).omit({ header: true }), { io: "input" })),
      output: z.preprocess(
        (value) =>
          typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, header } : value,
        Resume,
      ),
    },
  };
  const models = effectiveModels(deps);
  input = { ...input, maxPages: enforcePageLimit(input.maxPages, ctx.lockedMaxPages) };
  const warnings: string[] = [];
  const run = roleRunner(ctx, deps, usage, models, {
    applicationId: input.kind === "job" ? input.id : undefined,
    jobNotes: input.notes,
    baseId: input.kind === "base" ? input.id : undefined,
    baseGuidance: input.baseGuidance,
    onWarning: (message) => {
      if (!warnings.includes(message)) warnings.push(message);
    },
  });
  const reportModelWarnings = () => {
    for (const message of modelWarnings(models)) {
      if (warnings.includes(message)) continue;
      warnings.push(message);
      deps.onProgress?.({ stage: "warning", message });
    }
  };
  reportModelWarnings();
  let resume = input.seed;
  let review: Review | undefined;
  let tex = "";
  let pdf: Buffer | undefined;
  let markdown = "";
  const renderSources: RenderSources = { projects: ctx.projectsText, outline: ctx.outlineText };
  const evidence = writerEvidence(ctx, input);
  const writerSession = new RoleSession();
  const cache = deps.verdictCache ?? new VerdictCache();
  const context = [
    data("selected claims, variants and items", evidence),
    data("analysis", input.analysis),
    data("selection", input.selection ?? null),
    data("base config", input.baseConfig ?? null),
    data("effective pack", input.pack),
    data("rules", { ...ctx.rules, max_pages: input.maxPages }),
    data(
      "locked bullets",
      input.seed?.sections.flatMap((section) =>
        section.items.flatMap((item) => item.bullets.filter((bullet) => bullet.locked)),
      ) ?? [],
    ),
    data("job.md", input.jobText ?? ""),
    data("answers", input.answers ?? {}),
    data("answer claims (user-attested, citable)", input.answerClaims ?? []),
    data("must-haves to cover", input.mustCover ?? []),
    data("user notes", input.notes ?? ""),
  ].join("\n\n");
  // Two checked drafts total: initial draft plus one revision.
  try {
    for (let round = 1; round <= 2; round++) {
      deps.onProgress?.({ stage: round === 1 ? "write" : "revise", round });
      const draft = await run(
        writer,
        round > 1
          ? [
              "Revise the previous draft to address these review notes. Preserve locked bullets and the original generation constraints. Return submit_resume.",
              data("previous resume", resume),
              data("previous review", review),
            ].join("\n\n")
          : [
              `Generate a ${input.kind} resume with id ${input.id}, parent ${input.parent ?? "null"}, template ${input.template}, at most ${input.maxPages} pages.`,
              "Preserve locked bullets exactly, including visibility. Answer claims are the person's own dated statements from gap questions: you may cite their ids for bullets or skills, using only what they say (never inflate a basic understanding into expertise). Other answers (no, skip) are gaps: never write them as experience. Never invent claim IDs or grant overrides. Cover every entry in \"must-haves to cover\" with a bullet (or a skills entry) that cites one of its claim ids and uses the requirement's wording where the claim supports it; recruiters and ATS look for that wording.",
              ...(input.kind === "base"
                ? [
                    "Select and order content from the master resume for the direction in the following data.",
                    data("direction", input.direction),
                  ]
                : []),
              "The engine supplies the header from profile.yaml. Return the resume content without a header through submit_resume.",
              context,
              data("previous resume", resume ?? null),
              data("previous review", review ?? null),
            ].join("\n\n"),
        resume,
        input.analysis,
        writerSession,
      );
      resume = carryUserState(
        { ...draft, header, id: input.id, kind: input.kind, parent: input.parent, template: input.template },
        input.seed,
      );
      deps.onProgress?.({ stage: "lint", round });
      const lint: Finding[] = lintResume(resume, { index: ctx.index, pack: input.pack, rules: ctx.rules });
      if (lint.length)
        deps.onProgress?.({
          stage: "lint",
          round,
          message: lint.map((entry) => `${entry.rule}: ${entry.message}`).join("; "),
        });
      reportModelWarnings();
      const current = resume;
      cache.useModel(resolveRoleModel(models, "checker"));
      const { cached, pending, selected } = cache.partition(current, ctx.index);
      deps.onProgress?.({ stage: "check", round });
      const checkTask = async (): Promise<CheckNote[]> => {
        if (!pending.size) return cached;
        const { checks } = await run(
          checkerRole,
          [
            "Check every supplied visible bullet, including locked user bullets, against its complete claims and evidence. Return { checks: CheckNote[] } through submit_checks. Missing claims are explicitly marked; never assume support.",
            data("visible bullets and complete cited evidence", checkerContext(selected, ctx.index)),
          ].join("\n\n"),
          selected,
          input.analysis,
        );
        const checked = checks.filter((note) => pending.has(note.bulletId));
        cache.useModel(resolveRoleModel(models, "checker"));
        cache.remember(selected, ctx.index, checked);
        return [...cached, ...checked];
      };
      deps.onProgress?.({ stage: "render", round });
      pdf = undefined;
      tex = "";
      markdown = renderMarkdown(current, renderSources);
      const renderTask = async (): Promise<Review["render"]> => {
        try {
          const template = await loadTemplate(
            [resolveInWorkspace(ctx.ws.root, "templates"), join(ctx.ws.bundledDir, "templates")],
            current.template,
          );
          const patched = await renderStoredTex(ctx.ws.root, current, template, renderSources);
          const generated = patched.generated;
          tex = patched.patched;
          const compiled = await compileTex({ tex, assetsDir: template.dir });
          const result = checkPatchedRender(current, await pdfText(compiled.pdf), input.maxPages, generated, tex);
          if (patched.conflict) {
            result.patchConflict = true;
            lint.push({
              rule: "tex-patch-conflict",
              severity: "warn",
              message: "LaTeX patch conflicts; generated LaTeX was rendered. See tex.conflict.json.",
            });
          }
          pdf = compiled.pdf;
          return result;
        } catch (error) {
          deps.signal?.throwIfAborted();
          lint.push({
            rule: "render-failed",
            severity: "block",
            message: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      };
      const checksPromise = checkTask();
      const renderPromise = renderTask();
      // Read-render lets ATS start alongside the checker and compiler without hiding the final render result.
      const renderData = renderPromise.then(
        (render) => ({ render, findings: lint.filter((finding) => finding.rule === "render-failed") }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      );
      const atsTask = async (): Promise<AtsNote[]> => {
        if (input.kind !== "job") return [];
        deps.onProgress?.({ stage: "ats", round });
        const { ats } = await run(
          atsReviewerRole,
          [
            "Review coverage and ATS readability. Read this round's complete render result using read_render before submitting. Return { ats: AtsNote[] } through submit_ats.",
            data("resume", current),
            data("analysis", input.analysis),
            data("gaps", input.gaps),
          ].join("\n\n"),
          current,
          input.analysis,
          undefined,
          renderData,
        );
        return ats;
      };
      // Drain every stage before closing source/search resources, including on failure or cancellation.
      const stages = await Promise.allSettled([checksPromise, renderPromise, atsTask()]);
      const failure = stages.find((stage) => stage.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      const checks = (stages[0] as PromiseFulfilledResult<CheckNote[]>).value;
      const render = (stages[1] as PromiseFulfilledResult<Review["render"]>).value;
      const ats = (stages[2] as PromiseFulfilledResult<AtsNote[]>).value;
      deps.signal?.throwIfAborted();
      const overrides = visibleBullets(resume).flatMap((bullet) =>
        bullet.override
          ? [{ bulletId: bullet.id, reason: bullet.override.note ?? bullet.override.reason, at: bullet.override.at }]
          : [],
      );
      review = Review.parse({
        round,
        lint,
        checks,
        ats,
        render,
        gaps: input.gaps,
        overrides,
        ...evaluateDone({ resume, lint, checks, analysis: input.analysis, gaps: input.gaps, render, overrides }),
      });
      if (review.done) break;
    }
  } finally {
    writerSession.dispose();
  }
  if (!resume || !review) throw new Error("Generation produced no reviewed resume");
  return { resume, review, tex, pdf, markdown, warnings };
}
