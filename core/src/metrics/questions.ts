import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseConfig, type MetricQuestion, MetricQuestionsRequest, Resume, Slug, slugify } from "@vita/shared";
import { parse } from "yaml";
import { z } from "zod";
import { resolvePacks } from "../packs/index.js";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { type ProjectsItem, parseProjects } from "../source/index.js";
import { readText, resolveInWorkspace } from "../workspace/index.js";

export const dismissedPath = "config/dismissed-questions.yaml";
export const DismissedQuestions = z.array(z.string().min(1).max(200));
const Answers = z.record(z.string(), z.string());

export async function readDismissed(ws: WorkspaceHandle): Promise<string[]> {
  const text = await optionalText(ws.root, dismissedPath);
  return text === undefined ? [] : DismissedQuestions.parse(parse(text));
}

async function basePacks(ws: WorkspaceHandle): Promise<{ resume: Resume; packs: string[] }[]> {
  let dirs: string[];
  try {
    dirs = await readdir(resolveInWorkspace(ws.root, "resumes"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const bases: { resume: Resume; packs: string[] }[] = [];
  for (const id of dirs.sort()) {
    if (id === "master" || !Slug.safeParse(id).success) continue;
    const config = await optionalText(ws.root, `resumes/${id}/base.yaml`);
    if (config === undefined) continue;
    const resume = Resume.parse(JSON.parse(await readText(ws.root, `resumes/${id}/resume.json`)));
    bases.push({ resume, packs: BaseConfig.parse(parse(config)).packs });
  }
  return bases;
}

function includesItem(resume: Resume, item: ProjectsItem): boolean {
  const claims = new Set([...item.claims.map((claim) => claim.id), ...item.variants.map((variant) => variant.id)]);
  return resume.sections.some(
    (section) =>
      !section.hidden &&
      section.items.some(
        (entry) =>
          !entry.hidden &&
          (entry.source === item.slug ||
            claims.has(entry.source ?? "") ||
            slugify(entry.title) === item.slug ||
            entry.bullets.some((bullet) => !bullet.hidden && bullet.claims.some((id) => claims.has(id)))),
      ),
  );
}

/** Stable across ordering, limits, pack changes and unrelated source edits. */
function questionId(itemSlug: string, question: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([itemSlug, question.trim().toLowerCase()]))
    .digest("hex");
  return `metric-${hash.slice(0, 24)}`;
}

export async function questionsForSnapshot(ws: WorkspaceHandle, source: string): Promise<MetricQuestion[]> {
  const { doc } = parseProjects(source);
  const [bases, dismissed] = await Promise.all([basePacks(ws), readDismissed(ws)]);
  const skipped = new Set(dismissed);
  const questions: MetricQuestion[] = [];
  for (const item of doc.items) {
    if (
      item.claims.some((claim) =>
        claim.metrics.some((metric) => metric.kind === "measured" || metric.kind === "counted"),
      )
    )
      continue;
    const answers = Answers.parse(item.meta.metric_answers ?? {});
    const packIds = [...new Set(bases.filter((base) => includesItem(base.resume, item)).flatMap((base) => base.packs))];
    const pack = await resolvePacks(
      [resolveInWorkspace(ws.root, "packs"), join(ws.bundledDir, "packs")],
      packIds.length ? packIds : ["general"],
    );
    for (const text of pack.metric_questions) {
      const id = questionId(item.slug, text);
      if (skipped.has(id) || (answers[id] && item.meta.evidence.some((entry) => entry.id === answers[id]))) continue;
      questions.push({
        id,
        itemSlug: item.slug,
        itemName: item.name,
        ...(item.claims[0] ? { claimId: item.claims[0].id } : {}),
        question: `${item.name}: ${text.trim()}`,
        why: `${item.name} has no measured or counted metrics. Your answer can provide a dated statement of its scope or outcome.`,
      });
    }
  }
  return questions;
}

export async function metricQuestions(
  ws: WorkspaceHandle,
  input: MetricQuestionsRequest = {},
): Promise<MetricQuestion[]> {
  const { itemSlug, limit } = MetricQuestionsRequest.parse(input);
  const questions = await questionsForSnapshot(ws, await readText(ws.root, "projects.md"));
  return questions.filter((question) => itemSlug === undefined || question.itemSlug === itemSlug).slice(0, limit);
}
