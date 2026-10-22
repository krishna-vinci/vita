import { readdir } from "node:fs/promises";
import { FactQuestion, type FactQuestion as Question, Slug, slugify } from "@vita/shared";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { commitPaths, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { recordStatement } from "./chat-edits.js";
import { applySourceEdit } from "./edit.js";
import { idTitle, sourceLines } from "./markdown.js";
import { parseOutline } from "./outline.js";
import { parseProjects } from "./projects.js";
import { projectMetadataProposal } from "./relationship.js";
import patterns from "./result-patterns.json" with { type: "json" };

const year = /\b(?:19|20)\d{2}\b/;
const resultPatterns = patterns.results.map((pattern) => new RegExp(pattern, "iu"));
const stateSchema = z.object({ skipped: z.array(z.string()).default([]), answered: z.array(z.string()).default([]) });
async function optional(root: string, path: string) {
  try {
    return await readText(root, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}
async function state(root: string) {
  return stateSchema.parse(parse((await optional(root, "config/skipped-facts.yaml")) ?? "") ?? {});
}

/** Detect from source, with stable source slugs; selected dates take priority over results. */
export async function missingFacts(root: string, selected: string[] = []): Promise<Question[]> {
  const [projectsText, outlineText, remembered] = await Promise.all([
    readText(root, "projects.md"),
    readText(root, "outline.md"),
    state(root),
  ]);
  const projects = parseProjects(projectsText).doc.items;
  const questions: Question[] = [];
  const knownQuestions = new Set<string>();
  const add = (kind: Question["kind"], slug: string, name: string) => {
    const id = `${kind}.${slug}`;
    if (remembered.skipped.includes(id) || remembered.answered.includes(id)) return;
    const text =
      kind === "dates"
        ? `When did you work on ${name}?`
        : kind === "graduation"
          ? `What is your graduation or expected graduation year for ${name}?`
          : `What real usage, scale, performance, reliability or test results can you share for ${name}?`;
    questions.push({ id, kind, target: slug, text });
  };
  for (const item of projects) {
    for (const kind of ["dates", "graduation", "results"]) knownQuestions.add(`${kind}.${item.slug}`);
    const skipped = Array.isArray(item.meta.skipped) ? item.meta.skipped : [];
    if (["project", "role"].includes(item.meta.kind) && !item.meta.period?.trim() && !skipped.includes("dates"))
      add("dates", item.slug, item.name);
    if (item.meta.kind === "education" && !year.test(item.meta.period ?? "") && !skipped.includes("graduation"))
      add("graduation", item.slug, item.name);
    if (item.meta.kind === "project" && !skipped.includes("results")) {
      const hasResult = item.claims.some((claim) => {
        const receipts = item.meta.evidence.filter(
          (evidence) => claim.evidence.includes(evidence.id) && ["statement", "measurement"].includes(evidence.kind),
        );
        return (
          (claim.metrics.length > 0 || receipts.length > 0) &&
          resultPatterns.some((pattern) =>
            pattern.test([claim.text, ...receipts.map((receipt) => receipt.text ?? "")].join(" ")),
          )
        );
      });
      if (!hasResult) add("results", item.slug, item.name);
    }
  }
  for (const section of parseOutline(outlineText).sections) {
    const education = patterns.educationSections.includes(section.title.toLowerCase());
    const role = patterns.roleSections.includes(section.title.toLowerCase());
    if (!education && !role) continue;
    for (const entry of section.entries) {
      // Mirrored inventory entries have one canonical question/write target.
      if (
        projects.some(
          (item) =>
            idTitle(item.name) === idTitle(entry.title) ||
            entry.bullets.some((bullet) => item.claims.some((claim) => claim.id === bullet.claimId)),
        )
      )
        continue;
      const slug = idTitle(entry.title);
      knownQuestions.add(`${education ? "graduation" : "dates"}.${slug}`);
      if (!year.test([entry.title, ...entry.body.filter((line) => !line.trim().startsWith("-"))].join(" ")))
        add(education ? "graduation" : "dates", slug, entry.title);
    }
  }
  // Recruiter questions use this same answer path, including questions not detected mechanically.
  for (const parent of ["resumes", "applications"]) {
    let dirs: string[];
    try {
      dirs = await readdir(resolveInWorkspace(root, parent));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      continue;
    }
    for (const dir of dirs.sort().filter((dir) => Slug.safeParse(dir).success)) {
      const text = await optional(root, `${parent}/${dir}/review.json`);
      if (!text) continue;
      const findings = JSON.parse(text).recruiter?.findings ?? [];
      for (const finding of findings) {
        const question = FactQuestion.safeParse(finding.fix?.question);
        if (!question.success) continue;
        const q = question.data;
        q.target ??=
          /^(?:dates|graduation|results)\.(.+)$/.exec(q.id)?.[1] ??
          (q.kind === "other" ? "additional-facts" : undefined);
        if (!q.target) continue;
        if (
          !knownQuestions.has(q.id) &&
          !questions.some((entry) => entry.id === q.id) &&
          !remembered.skipped.includes(q.id) &&
          !remembered.answered.includes(q.id)
        )
          questions.push(q);
      }
    }
  }
  const priority = (q: Question) => {
    const rank = selected.indexOf(q.target ?? "");
    if (!selected.length) return q.kind === "dates" ? 0 : q.kind === "results" ? 1000 : 2000;
    return (
      (rank >= 0
        ? q.kind === "dates"
          ? 0
          : q.kind === "results"
            ? 1000
            : 2000
        : q.kind === "dates"
          ? 3000
          : q.kind === "results"
            ? 4000
            : 5000) + Math.max(rank, 0)
    );
  };
  return questions.sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
}

/** Callers serialize workspace mutations. All answers come directly from the person. */
export async function answerMissingFacts(root: string, answers: Record<string, string>, now = new Date()) {
  const questions = await missingFacts(root);
  // Validate question ids and basic answer shapes before the first source mutation.
  for (const [id, answer] of Object.entries(answers)) {
    const question = questions.find((question) => question.id === id);
    if (!question?.target) throw new Error(`Unknown missing-facts question: ${id}`);
    if (!answer.trim() || answer.length > 20_000) throw new Error(`Invalid answer: ${id}`);
    if (
      answer.trim().toLowerCase() !== "skip" &&
      ["dates", "graduation"].includes(question.kind) &&
      (!year.test(answer) || /[\r\n]/.test(answer))
    )
      throw new Error(`Answer needs a year on one line: ${id}`);
    if (
      answer.trim().toLowerCase() !== "skip" &&
      ["results", "other"].includes(question.kind) &&
      (answer.trim().length < 12 || answer.trim().split(/\s+/).length < 3)
    )
      throw new Error(`Answer needs a few words about your work: ${id}`);
  }
  const remembered = await state(root);
  const shas: (string | null)[] = [];
  for (const [id, raw] of Object.entries(answers)) {
    const question = questions.find((question) => question.id === id);
    if (!question?.target) continue;
    const answer = raw.trim();
    const skip = answer.toLowerCase() === "skip";
    const projects = await readText(root, "projects.md");
    const item = parseProjects(projects).doc.items.find((item) => item.slug === question.target);
    if (skip) {
      if (item) {
        const skipped = Array.isArray(item.meta.skipped) ? item.meta.skipped : [];
        const proposal = projectMetadataProposal(
          projects,
          (await fileHash(root, "projects.md")) ?? "",
          item.slug,
          { skipped: [...new Set([...skipped, question.kind])] },
          `Skip ${id}`,
        );
        shas.push((await applySourceEdit({ root, bundledDir: "" }, proposal, "user")).sha);
      }
      remembered.skipped.push(id);
    } else if (question.kind === "results" || question.kind === "other") {
      // Reuse M10's quote validation and statement evidence/claim writer.
      if (!item && question.kind === "other" && question.target === "additional-facts") {
        const before = await readText(root, "outline.md");
        const entries = parseOutline(before).sections.flatMap((section) => [section, ...section.entries]);
        if (!entries.some((entry) => idTitle(entry.title) === question.target)) {
          const eol = before.includes("\r\n") ? "\r\n" : "\n";
          await applySourceEdit(
            { root, bundledDir: "" },
            {
              file: "outline",
              before,
              after: `${before}${before.endsWith("\n") ? "" : eol}${eol}## Additional facts${eol}`,
              baseHash: (await fileHash(root, "outline.md")) ?? "",
              summary: "Add your additional facts",
            },
            "user",
          );
        }
      }
      const outline = item ? undefined : parseOutline(await readText(root, "outline.md"));
      const matches =
        outline?.sections
          .flatMap((section) => [section, ...section.entries])
          .filter((entry) => idTitle(entry.title) === question.target) ?? [];
      if (!item && matches.length !== 1) throw new Error(`Outline item not found or ambiguous: ${question.target}`);
      const statementTarget = item?.slug ?? slugify(matches[0]?.title ?? question.target);
      const result = await recordStatement(
        root,
        { itemSlug: statementTarget, quote: answer, claimText: answer },
        { messages: [answer], threadId: `facts-${slugify(id)}`, now },
      );
      shas.push(result.sha);
      remembered.answered.push(id);
    } else if (item) {
      const proposal = projectMetadataProposal(
        projects,
        (await fileHash(root, "projects.md")) ?? "",
        item.slug,
        { period: answer },
        `Answer ${id}`,
      );
      shas.push((await applySourceEdit({ root, bundledDir: "" }, proposal, "user")).sha);
      remembered.answered.push(id);
    } else {
      const before = await readText(root, "outline.md");
      const entries = parseOutline(before).sections.flatMap((section) => section.entries);
      const matches = entries.filter((entry) => idTitle(entry.title) === question.target);
      if (matches.length !== 1 || !matches[0])
        throw new Error(`Outline item not found or ambiguous: ${question.target}`);
      const lines = sourceLines(before);
      const line = lines[matches[0].line - 1];
      if (!line) throw new Error("Outline line missing");
      line.text += ` | ${answer}`;
      const after = lines.map((line) => line.text + line.ending).join("");
      shas.push(
        (
          await applySourceEdit(
            { root, bundledDir: "" },
            {
              file: "outline",
              before,
              after,
              baseHash: (await fileHash(root, "outline.md")) ?? "",
              summary: `Answer ${id}`,
            },
            "user",
          )
        ).sha,
      );
      remembered.answered.push(id);
    }
  }
  if (Object.keys(answers).length) {
    await writeTextAtomic(
      root,
      "config/skipped-facts.yaml",
      stringify({ skipped: [...new Set(remembered.skipped)], answered: [...new Set(remembered.answered)] }),
    );
    shas.push(await commitPaths(root, ["config/skipped-facts.yaml"], "Remember fact answers", "user"));
  }
  return { questions: await missingFacts(root), shas };
}
