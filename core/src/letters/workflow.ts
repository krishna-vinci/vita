import { createHash } from "node:crypto";
import {
  type Finding,
  GenerateLetterRequest,
  JobAnalysis,
  Letter,
  type LetterChatReply,
  LetterChatRequest,
  type LetterOp,
  LetterParagraph,
  LetterResource,
  LetterReview,
  LetterOp as opSchema,
  Resume,
  Review,
  Slug,
} from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import { RoleError, type RoleSpec, resolveRoleModel } from "../agent/index.js";
import { checkerRole, writerRole } from "../agent/roles.js";
import { chatTask } from "../chat/context.js";
import { lintResume } from "../lint/index.js";
import { OpError } from "../ops/index.js";
import { effectivePack, loadContext, optionalText } from "../pipeline/context.js";
import { evaluateDone } from "../pipeline/done.js";
import { reviewChecks } from "../pipeline/efficient-context.js";
import { data, effectiveModels, roleRunner } from "../pipeline/generate.js";
import { withGenerationLock } from "../pipeline/lock.js";
import { loadProfile } from "../pipeline/profile.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, fileHash, readText, writeFileAtomic, writeTextAtomic } from "../workspace/index.js";
import { applyParagraphOps, carryParagraphLocks } from "./ops.js";
import { letterResume, renderLetter } from "./render.js";

export class LetterBlockedError extends Error {
  constructor(
    public readonly code: "review-blocked" | "stale-hash",
    message: string,
  ) {
    super(message);
    this.name = "LetterBlockedError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function paragraphHash(paragraph: LetterParagraph): string {
  return digest([paragraph.text, [...paragraph.claims].sort()]);
}

const draftSchema = z.strictObject({
  greeting: z.string(),
  paragraphs: z
    .array(LetterParagraph.pick({ id: true, text: true, claims: true }))
    .min(1)
    .max(20),
  closing: Letter.shape.closing,
});
const letterWriter: RoleSpec<z.infer<typeof draftSchema>> = {
  ...writerRole,
  skills: ["write-letter"],
  submitTool: {
    name: "submit_letter",
    description: "Submit an evidence-backed cover letter. The engine supplies the greeting and signature.",
    parameters: Type.Unsafe(z.toJSONSchema(draftSchema, { io: "input" })),
    output: draftSchema,
  },
};
const chatSchema = z.strictObject({ ops: z.array(opSchema).max(100), summary: z.string().min(1) });
// The API and model use the same operations, with no file-writing tool.
const letterEditor: RoleSpec<z.infer<typeof chatSchema>> = {
  name: "resume-editor",
  skills: ["write-letter"],
  readTools: ["search_evidence", "read_projects"],
  submitTool: {
    name: "propose_letter_ops",
    description: "Propose the smallest supported paragraph operations, or no ops and an honest alternative.",
    parameters: Type.Unsafe(z.toJSONSchema(chatSchema, { io: "input" })),
    output: chatSchema,
  },
};

async function session<T>(
  ws: WorkspaceHandle,
  id: string,
  deps: PipelineDeps,
  action: (state: Awaited<ReturnType<typeof loadSession>>) => Promise<T>,
) {
  Slug.parse(id);
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const state = await loadSession(ws, id, deps);
    try {
      return await action(state);
    } finally {
      state.ctx.search.close();
    }
  });
}

async function loadSession(ws: WorkspaceHandle, id: string, deps: PipelineDeps) {
  const prefix = `applications/${id}`;
  const paths = [
    "outline.md",
    "projects.md",
    "profile.yaml",
    "config/rules.yaml",
    "config/models.yaml",
    "instructions.md",
    ...[
      "job.md",
      "analysis.json",
      "resume.json",
      "meta.yaml",
      "review.json",
      "letter.json",
      "letter-review.json",
      "out/letter.pdf",
      "out/letter.md",
    ].map((path) => `${prefix}/${path}`),
  ];
  const expected = await Promise.all(paths.map(async (path) => [path, await fileHash(ws.root, path)] as const));
  const [profile, job, analysisText, resumeText, reviewText, letterText, letterReviewText] = await Promise.all([
    loadProfile(ws.root),
    readText(ws.root, `${prefix}/job.md`),
    readText(ws.root, `${prefix}/analysis.json`),
    readText(ws.root, `${prefix}/resume.json`),
    optionalText(ws.root, `${prefix}/review.json`),
    optionalText(ws.root, `${prefix}/letter.json`),
    optionalText(ws.root, `${prefix}/letter-review.json`),
  ]);
  const analysis = JobAnalysis.extend({ recipient: z.string().optional() }).parse(JSON.parse(analysisText));
  const resume = Resume.parse(JSON.parse(resumeText));
  const sourceReview = reviewText ? Review.parse(JSON.parse(reviewText)) : undefined;
  const letter = letterText ? Letter.parse(JSON.parse(letterText)) : undefined;
  const previousReview = letterReviewText ? LetterReview.parse(JSON.parse(letterReviewText)) : undefined;
  const ctx = await loadContext(ws);
  try {
    const pack = await effectivePack(
      ctx,
      ctx.bases.find((base) => base.id === resume.parent),
    );
    const models = effectiveModels(deps);
    const usage: RoleUsage[] = [];
    const sourceHash = digest([...ctx.index.claims.values()]);
    const run = roleRunner(ctx, deps, usage, models, { applicationId: id });
    const frame = (value: Letter) =>
      Letter.parse({
        ...value,
        greeting: analysis.recipient ? `Dear ${analysis.recipient},` : "Dear Hiring Team,",
        signature: profile.name,
      });
    const lint = (value: Letter, maxChars = 900): Finding[] =>
      lintResume(letterResume(value, id, profile), {
        index: ctx.index,
        pack,
        rules: { ...ctx.rules, max_bullet_chars: maxChars },
        quality: false,
      }).filter((finding) => finding.bulletId !== undefined);
    const certify = async (
      value: Letter,
      writerModel: string,
      round: number,
      previous?: LetterReview,
      changed?: Set<string>,
      maxChars = 900,
    ) => {
      models.roles.writer = writerModel;
      const checkerModel = deps.modelOverrides?.checker;
      const checker = checkerModel
        ? `${checkerModel.provider}/${checkerModel.id}`
        : resolveRoleModel(models, "checker");
      if (checker === writerModel)
        throw new RoleError("checker", checker, "The cover-letter checker must use a different model from the writer.");
      const paragraphState = Object.fromEntries(
        value.paragraphs.map((paragraph) => {
          const hash = paragraphHash(paragraph);
          const previousState = previousReview?.paragraphState[paragraph.id];
          const author =
            paragraph.origin === "user"
              ? "user"
              : previousState?.hash === hash
                ? previousState.writerModel
                : writerModel;
          return [paragraph.id, { hash, writerModel: author }];
        }),
      );
      if (
        value.paragraphs.some((paragraph) => !paragraph.hidden && paragraphState[paragraph.id]?.writerModel === checker)
      )
        throw new RoleError(
          "checker",
          checker,
          "The checker cannot review a paragraph it wrote in an earlier request.",
        );
      const adapted = letterResume(value, id, profile);
      const visible = value.paragraphs.filter((paragraph) => !paragraph.hidden);
      const selected = visible.filter(
        (paragraph) =>
          !changed ||
          changed.has(paragraph.id) ||
          previous?.sourceHash !== sourceHash ||
          previous.paragraphState[paragraph.id]?.hash !== paragraphHash(paragraph) ||
          !previous.checks.some((note) => note.bulletId === paragraph.id && note.verdict === "supported") ||
          previous.checks.some((note) => note.bulletId === paragraph.id && note.verdict !== "supported"),
      );
      let checks =
        previous?.checks.filter(
          (note) =>
            visible.some((paragraph) => paragraph.id === note.bulletId) &&
            !selected.some((paragraph) => paragraph.id === note.bulletId),
        ) ?? [];
      const findings = lint(value, maxChars);
      deps.onProgress?.({ stage: "lint", round });
      if (selected.length) {
        deps.onProgress?.({ stage: "check", round });
        const checkResume = letterResume({ ...value, paragraphs: selected }, id, profile);
        // A fallback must also stay off models that wrote unchanged paragraphs in earlier requests.
        if (visible.some((paragraph) => paragraphState[paragraph.id]?.writerModel === models.default))
          models.roles.writer = models.default;
        const output = await run(
          checkerRole,
          [
            "Check every supplied cover-letter paragraph, including user-written and locked ones. Treat paragraphs as bullets and use paragraph IDs as bulletId. Judge all facts, skills, numbers, ownership and outcomes against the full claims, linked evidence, metrics and limits. Motivations may be phrased as intentions; do not excuse unsupported factual assertions. Return submit_checks.",
            data("letter paragraphs", selected),
            data("resume adapter", checkResume),
            data("claims with evidence, metrics and limits", [...ctx.index.claims.values()]),
            data("job.md", job),
            data("analysis", analysis),
          ].join("\n\n"),
          checkResume,
          analysis,
        );
        models.roles.writer = writerModel;
        const ids = new Set(selected.map((paragraph) => paragraph.id));
        checks = [...checks, ...output.checks.filter((note) => ids.has(note.bulletId))];
      }
      deps.onProgress?.({ stage: "render", round });
      let rendered: Awaited<ReturnType<typeof renderLetter>> | undefined;
      try {
        rendered = await renderLetter(ws, id, value, profile, analysis);
      } catch (error) {
        deps.signal?.throwIfAborted();
        deps.onProgress?.({ stage: "render", round, message: error instanceof Error ? error.message : String(error) });
      }
      checks = reviewChecks(checks, adapted, ctx.index, ctx.rules.honesty);
      const review = LetterReview.parse({
        round,
        lint: findings,
        checks,
        ats: [],
        render: rendered?.render ?? null,
        gaps: sourceReview?.gaps ?? [],
        overrides: [],
        writerModel,
        sourceHash,
        paragraphState,
        ...evaluateDone({
          honesty: ctx.rules.honesty,
          resume: adapted,
          lint: findings,
          checks,
          analysis,
          gaps: sourceReview?.gaps ?? [],
          render: rendered?.render ?? null,
          overrides: [],
        }),
      });
      return { letter: value, review, rendered };
    };
    const save = async (
      result: Awaited<ReturnType<typeof certify>>,
      author: "writer" | "user" | "editor",
      message: string,
      requireDone = false,
    ) => {
      deps.signal?.throwIfAborted();
      for (const [path, hash] of expected)
        if ((await fileHash(ws.root, path)) !== hash)
          throw new LetterBlockedError("stale-hash", `Workspace changed during the letter request: ${path}`);
      if (requireDone && !result.review.done)
        throw new LetterBlockedError("review-blocked", result.review.blocking.join("; "));
      const files: Record<string, string | Buffer> = {
        [`${prefix}/letter.json`]: `${JSON.stringify(result.letter, null, 2)}\n`,
        [`${prefix}/letter-review.json`]: `${JSON.stringify(result.review, null, 2)}\n`,
      };
      // Keep the last good exported files until the whole review passes.
      if (result.review.done && result.rendered) {
        files[`${prefix}/out/letter.pdf`] = result.rendered.pdf;
        files[`${prefix}/out/letter.md`] = result.rendered.markdown;
      }
      for (const [path, content] of Object.entries(files)) {
        if (typeof content === "string") await writeTextAtomic(ws.root, path, content);
        else await writeFileAtomic(ws.root, path, content);
      }
      return commitPaths(ws.root, Object.keys(files), message, author);
    };
    return {
      prefix,
      ctx,
      profile,
      job,
      analysis,
      resume,
      sourceReview,
      pack,
      letter,
      previousReview,
      models,
      usage,
      run,
      frame,
      lint,
      certify,
      save,
    };
  } catch (error) {
    ctx.search.close();
    throw error;
  }
}

export async function getLetter(ws: WorkspaceHandle, id: string): Promise<LetterResource> {
  Slug.parse(id);
  const prefix = `applications/${id}`;
  const [text, review, hash, pdfHash] = await Promise.all([
    readText(ws.root, `${prefix}/letter.json`),
    optionalText(ws.root, `${prefix}/letter-review.json`),
    fileHash(ws.root, `${prefix}/letter.json`),
    fileHash(ws.root, `${prefix}/out/letter.pdf`),
  ]);
  return LetterResource.parse({
    letter: JSON.parse(text),
    review: review ? JSON.parse(review) : null,
    hash: hash ?? "",
    pdfUrl: pdfHash ? `/api/files/${prefix}/out/letter.pdf` : null,
  });
}

export async function generateLetter(
  ws: WorkspaceHandle,
  applicationId: string,
  deps: PipelineDeps,
  opts: GenerateLetterRequest = {},
) {
  const options = GenerateLetterRequest.parse(opts);
  return session(ws, applicationId, deps, async (state) => {
    let letter = state.letter;
    let review: LetterReview | undefined;
    let result: Awaited<ReturnType<typeof state.certify>> | undefined;
    for (let round = 1; round <= 3; round++) {
      deps.onProgress?.({ stage: round === 1 ? "write" : "revise", round });
      const draft = await state.run(
        letterWriter,
        [
          "Write a cover letter: 3–4 short paragraphs, why this role, two or three pieces of evidence matching must-haves, and a closing invitation. Cite real claim IDs in every paragraph. Preserve locked paragraphs, including visibility and order. The engine supplies the greeting and signature from the application and profile. Never turn job requirements or unanswered gaps into personal experience. Return submit_letter.",
          data("letter preferences", {
            tone: options.tone ?? "plain",
            length: options.length ?? "standard",
            notes: options.notes ?? "",
          }),
          data("job.md", state.job),
          data("analysis", state.analysis),
          data("job resume", state.resume),
          data("recorded application gaps", state.sourceReview?.gaps ?? []),
          data("effective pack", state.pack),
          data("writing rules", state.ctx.rules),
          data("claims with evidence, metrics and limits", [...state.ctx.index.claims.values()]),
          data("previous letter", letter ?? null),
          data("previous letter review", review ?? null),
        ].join("\n\n"),
        state.resume,
        state.analysis,
      );
      letter = state.frame(
        carryParagraphLocks(Letter.parse({ ...draft, signature: state.profile.name }), state.letter),
      );
      const writerModel = state.models.roles.writer ?? resolveRoleModel(state.models, "writer");
      result = await state.certify(
        letter,
        writerModel,
        round,
        undefined,
        undefined,
        options.length === "short" ? 600 : 900,
      );
      review = result.review;
      const count = letter.paragraphs.filter((paragraph) => !paragraph.hidden).length;
      if (count < 3 || count > 4)
        review.lint.push({ rule: "letter-length", severity: "warn", message: "Use 3–4 short paragraphs." });
      if (review.done && !review.lint.some((finding) => finding.severity === "warn")) break;
    }
    if (!result) throw new Error("No cover letter was generated");
    const sha = await state.save(result, "writer", `Generate cover letter: ${applicationId}`);
    deps.onProgress?.({
      stage: "done",
      round: result.review.round,
      message: result.review.done ? "Cover letter checks passed." : result.review.blocking.join("; "),
    });
    return { letter: result.letter, review: result.review, sha, usage: state.usage };
  });
}

export async function applyLetterOps(
  ws: WorkspaceHandle,
  id: string,
  ops: LetterOp[],
  deps: PipelineDeps,
  opts: { baseHash?: string } = {},
) {
  return session(ws, id, deps, async (state) => {
    if (!state.letter) await readText(ws.root, `${state.prefix}/letter.json`);
    if (!state.letter) throw new Error("Missing cover letter");
    if (opts.baseHash !== undefined && (await fileHash(ws.root, `${state.prefix}/letter.json`)) !== opts.baseHash)
      throw new LetterBlockedError("stale-hash", "Cover letter changed. Reload before saving.");
    const applied = applyParagraphOps(state.letter, ops, "user");
    const result = await state.certify(
      state.frame(applied.letter),
      state.previousReview?.writerModel ?? resolveRoleModel(state.models, "writer"),
      state.previousReview?.round ?? 0,
      state.previousReview,
      new Set(applied.changedParagraphs),
    );
    const sha = await state.save(result, "user", "Apply cover letter edits");
    return { ...(await getLetter(ws, id)), sha, changedParagraphs: applied.changedParagraphs, usage: state.usage };
  });
}

export async function chatLetter(
  ws: WorkspaceHandle,
  id: string,
  input: LetterChatRequest,
  deps: PipelineDeps,
): Promise<LetterChatReply> {
  const request = LetterChatRequest.parse(input);
  return session(ws, id, deps, async (state) => {
    if (!state.letter) await readText(ws.root, `${state.prefix}/letter.json`);
    if (!state.letter) throw new Error("Missing cover letter");
    if (request.baseHash !== undefined && (await fileHash(ws.root, `${state.prefix}/letter.json`)) !== request.baseHash)
      throw new LetterBlockedError("stale-hash", "Cover letter changed. Reload before chatting.");
    const output = await state.run(
      letterEditor,
      [
        chatTask(request.message, request.history),
        "Return propose_letter_ops with paragraph.edit, paragraph.hide or move, and a summary. An explicit chat request authorizes immediate undoable edits. Never change locked paragraphs or cite the chat request as approved evidence. Refuse unsupported skills, numbers or outcomes with ops: [] and an honest alternative.",
        data("letter.json", state.letter),
        data("claims with evidence and limits", [...state.ctx.index.claims.values()]),
      ].join("\n\n"),
      undefined,
      state.analysis,
    );
    const refusal = (reply: string): LetterChatReply => ({
      reply,
      ops: [],
      applied: false,
      sha: null,
      changedParagraphs: [],
      review: state.previousReview ?? null,
    });
    if (!output.ops.length) return refusal(output.summary);
    let applied: ReturnType<typeof applyParagraphOps>;
    try {
      applied = applyParagraphOps(state.letter, output.ops, "ai");
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      return refusal(error.message);
    }
    // Hidden edits must pass the same mechanical checks before the model can conceal them.
    const honest = structuredClone(applied.letter);
    const changed = new Set(applied.changedParagraphs);
    for (const paragraph of honest.paragraphs) if (changed.has(paragraph.id)) paragraph.hidden = false;
    if (state.lint(honest).some((finding) => finding.severity === "block" && changed.has(finding.bulletId ?? "")))
      return refusal(
        "I cannot add facts or numbers without supporting evidence. Add a source or an approved dated statement first.",
      );
    const editorModel =
      state.usage.findLast((entry) => entry.role === "resume-editor")?.model ??
      resolveRoleModel(state.models, "resume-editor");
    const result = await state.certify(
      state.frame(applied.letter),
      editorModel,
      state.previousReview?.round ?? 0,
      state.previousReview,
      changed,
    );
    const sha = await state.save(result, "editor", "Apply cover letter chat edits");
    return {
      reply: output.summary,
      ops: output.ops,
      applied: true,
      sha,
      changedParagraphs: applied.changedParagraphs,
      review: result.review,
    };
  });
}

export async function exportLetter(ws: WorkspaceHandle, id: string, deps: PipelineDeps) {
  return session(ws, id, deps, async (state) => {
    if (!state.letter) await readText(ws.root, `${state.prefix}/letter.json`);
    if (!state.letter) throw new Error("Missing cover letter");
    // Recheck all paragraphs against current source evidence and recompile before export.
    const result = await state.certify(
      state.frame(state.letter),
      state.previousReview?.writerModel ?? resolveRoleModel(state.models, "writer"),
      state.previousReview?.round ?? 0,
    );
    const sha = await state.save(result, "user", "Export cover letter", true);
    const resource = await getLetter(ws, id);
    return { resource, sha, pdfUrl: `/api/files/${state.prefix}/out/letter.pdf` };
  });
}
