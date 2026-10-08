import { join } from "node:path";
import {
  type AtsNote,
  type BaseConfig,
  type Finding,
  type JobAnalysis,
  type Pack,
  Resume,
  Review,
  visibleBullets,
} from "@vita/shared";
import { buildSystemPrompt, modelWarnings, type RoleSpec, runRole, wrapUntrusted } from "../agent/index.js";
import { atsReviewerRole, checkerRole, writerRole } from "../agent/roles.js";
import { lintResume } from "../lint/index.js";
import { checkRender, compileTex, loadTemplate, pdfText, renderMarkdown, renderTex } from "../render/index.js";
import type { Selection } from "../search/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import type { Context } from "./context.js";
import { evaluateDone } from "./done.js";
import type { PipelineDeps, RoleUsage } from "./types.js";

export function data(source: string, value: unknown): string {
  return wrapUntrusted(source, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

export function effectiveModels(deps: PipelineDeps): PipelineDeps["models"] {
  const models = { ...deps.models, roles: { ...deps.models.roles } };
  for (const [role, model] of Object.entries(deps.modelOverrides ?? {})) {
    if (model) models.roles[role as keyof typeof models.roles] = `${model.provider}/${model.id}`;
  }
  return models;
}

export function roleRunner(ctx: Context, deps: PipelineDeps, usage: RoleUsage[], models = effectiveModels(deps)) {
  return async <O>(role: RoleSpec<O>, task: string, resume?: Resume, analysis?: JobAnalysis): Promise<O> => {
    deps.signal?.throwIfAborted();
    let system = await buildSystemPrompt({
      role,
      root: ctx.ws.root,
      bundledDir: ctx.ws.bundledDir,
      task: "Follow the generation task in the user message.",
    });
    if (role.name === "checker") {
      system +=
        "\n\nCore review policy: check every visible bullet, including locked user bullets. Only recorded user overrides may excuse a verdict. This policy takes precedence over skill guidance to skip locked bullets.";
    }
    return runRole({
      role,
      task,
      system,
      root: ctx.ws.root,
      tools: { root: ctx.ws.root, index: ctx.index, search: ctx.search, resume, analysis },
      runtime: deps.runtime,
      models,
      modelOverride: deps.modelOverrides?.[role.name],
      signal: deps.signal,
      retry: deps.retry,
      onUsage: (entry) => {
        usage.push(entry);
        deps.onUsage?.(entry);
        // Fallback safety uses the actual writer, including a rate-limit fallback.
        if (role.name === "writer") models.roles.writer = entry.model;
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
  direction?: string;
  notes?: string;
}

export async function generate(ctx: Context, input: GenerationInput, deps: PipelineDeps, usage: RoleUsage[]) {
  const models = effectiveModels(deps);
  const run = roleRunner(ctx, deps, usage, models);
  const warnings: string[] = [];
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
  const claims = input.selection
    ? input.selection.claimIds.flatMap((id) => ctx.index.claims.get(id) ?? [])
    : [...ctx.index.claims.values()];
  const variants = input.selection
    ? input.selection.items.flatMap((item) => item.variantIds.flatMap((id) => ctx.index.variants.get(id) ?? []))
    : [...ctx.index.variants.values()];
  const context = [
    data("outline.md", ctx.outlineText),
    data("projects.md", ctx.projectsText),
    data("claims", claims),
    data("variants", variants),
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
    data("user notes", input.notes ?? ""),
  ].join("\n\n");
  // Two checked drafts total: initial draft plus one revision.
  for (let round = 1; round <= 2; round++) {
    deps.onProgress?.({ stage: round === 1 ? "write" : "revise", round });
    const draft = await run(
      input.kind === "base" ? { ...writerRole, skills: [...writerRole.skills, "build-base"] } : writerRole,
      [
        `Generate a ${input.kind} resume with id ${input.id}, parent ${input.parent ?? "null"}, template ${input.template}, at most ${input.maxPages} pages.`,
        "Preserve locked bullets exactly, including visibility. User answers are context pending source approval; they do not create new claims or metrics. Never invent claim IDs or grant overrides.",
        ...(input.kind === "base"
          ? [
              "Select and order content from the master resume for the direction in the following data.",
              data("direction", input.direction),
            ]
          : []),
        "Return the complete Resume object through submit_resume.",
        context,
        data("previous resume", resume ?? null),
        data("previous review", review ?? null),
      ].join("\n\n"),
      resume,
      input.analysis,
    );
    resume = carryUserState(
      { ...draft, id: input.id, kind: input.kind, parent: input.parent, template: input.template },
      input.seed,
    );
    deps.onProgress?.({ stage: "lint", round });
    const lint: Finding[] = lintResume(resume, { index: ctx.index, pack: input.pack, rules: ctx.rules });
    for (const title of ctx.rules.required_sections ?? []) {
      if (!resume.sections.some((section) => !section.hidden && section.title === title))
        lint.push({ rule: "required-section", severity: "warn", message: `Missing section: ${title}` });
    }
    const order = ctx.rules.section_order ?? input.pack.section_order;
    const positions = resume.sections
      .filter((section) => !section.hidden)
      .map((section) => order.indexOf(section.title))
      .filter((position) => position >= 0);
    if (positions.some((position, index) => index > 0 && position < (positions[index - 1] ?? 0)))
      lint.push({ rule: "section-order", severity: "warn", message: "Sections differ from the configured order." });
    if (lint.length)
      deps.onProgress?.({
        stage: "lint",
        round,
        message: lint.map((entry) => `${entry.rule}: ${entry.message}`).join("; "),
      });
    reportModelWarnings();
    deps.onProgress?.({ stage: "check", round });
    const { checks } = await run(
      checkerRole,
      [
        "Check every visible bullet, including locked user bullets, against its claims and evidence. Return { checks: CheckNote[] } through submit_checks.",
        data("resume", resume),
        data("claims", [...ctx.index.claims.values()]),
      ].join("\n\n"),
      resume,
      input.analysis,
    );
    deps.onProgress?.({ stage: "render", round });
    let render: Review["render"] = null;
    pdf = undefined;
    tex = "";
    markdown = renderMarkdown(resume);
    try {
      const template = await loadTemplate(
        [resolveInWorkspace(ctx.ws.root, "templates"), join(ctx.ws.bundledDir, "templates")],
        resume.template,
      );
      tex = renderTex(resume, template);
      const compiled = await compileTex({ tex, assetsDir: template.dir });
      render = checkRender(resume, await pdfText(compiled.pdf), input.maxPages);
      pdf = compiled.pdf;
    } catch (error) {
      deps.signal?.throwIfAborted();
      lint.push({
        rule: "render-failed",
        severity: "block",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    deps.signal?.throwIfAborted();
    let ats: AtsNote[] = [];
    if (input.kind === "job") {
      deps.onProgress?.({ stage: "ats", round });
      ({ ats } = await run(
        atsReviewerRole,
        [
          "Review coverage and ATS readability. Return { ats: AtsNote[] } through submit_ats.",
          data("resume", resume),
          data("analysis", input.analysis),
          data("render", render),
          data("gaps", input.gaps),
        ].join("\n\n"),
        resume,
        input.analysis,
      ));
    }
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
  if (!resume || !review) throw new Error("Generation produced no reviewed resume");
  return { resume, review, tex, pdf, markdown, warnings };
}
