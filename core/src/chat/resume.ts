import { join } from "node:path";
import { type Finding, Resume, type ResumeChatReply, Review, Slug } from "@vita/shared";
import { chatTools, type StatementConversation } from "../agent/chat-tools.js";
import { buildSystemPrompt, runRole, wrapUntrusted } from "../agent/index.js";
import { lintResume } from "../lint/index.js";
import { proposeMemory } from "../memory/index.js";
import { applyOps, OpError } from "../ops/index.js";
import { effectivePack, loadContext, optionalText } from "../pipeline/context.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { loadTemplate } from "../render/index.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { fieldChanges } from "./changes.js";
import { ChatConflictError, chatTask } from "./context.js";
import { resumeEditorRole } from "./roles.js";

const edits = new FileLocks();

export async function chatResume(
  ws: WorkspaceHandle,
  input: { scope: "application" | "resume"; id: string } & StatementConversation,
  deps: PipelineDeps,
): Promise<ResumeChatReply> {
  Slug.parse(input.id);
  if (input.scope !== "application" && input.scope !== "resume") throw new Error("Invalid chat scope");
  const prefix = `${input.scope === "application" ? "applications" : "resumes"}/${input.id}`;
  const rel = `${prefix}/resume.json`;
  const release = await edits.acquire(resolveInWorkspace(ws.root, rel), "chatResume");
  try {
    const expected = await fileHash(ws.root, rel);
    const resume = Resume.parse(JSON.parse(await readText(ws.root, rel)));
    const ctx = await loadContext(ws);
    try {
      const base = ctx.bases.find((entry) => entry.id === (resume.kind === "base" ? resume.id : resume.parent));
      const pack = await effectivePack(ctx, base);
      const tools = { root: ws.root, index: ctx.index, search: ctx.search, resume };
      const edits = chatTools(ctx, input, deps, tools);
      const output = await runRole({
        role: resumeEditorRole,
        root: ws.root,
        system: await buildSystemPrompt({
          role: resumeEditorRole,
          root: ws.root,
          bundledDir: ws.bundledDir,
          applicationId: input.scope === "application" ? input.id : undefined,
          chat: input.message,
          onWarning: (message) => deps.onProgress?.({ stage: "warning", message }),
          task: "Answer the resume chat request with the smallest edits. Metadata needs no evidence. Never grant user overrides.",
        }),
        task: [
          chatTask(input.message, input.history),
          `Honesty level: ${ctx.rules.honesty}. Return propose_ops with { ops, summary, memory? }. An explicit chat request authorizes immediate undoable edits. Apply metadata with item.set, header.set, set_project_links or set_profile without receipts. Read outline/projects to find existing URLs; never guess URLs. In balanced/trust, record facts the person actually states with record_statement, then cite the returned claimId in bullet.add in this same turn. In strict, use existing claims. Ask one short question only for a fact the person has not stated (asking to add a skill does not say they used it). Never send the person elsewhere or ask for dated source evidence. Preserve claim IDs and locked bullets. Lasting preferences may be proposed as memory; memory is not evidence.`,
          wrapUntrusted("resume.json", JSON.stringify(resume)),
          wrapUntrusted("claims and evidence", JSON.stringify([...ctx.index.claims.values()])),
        ].join("\n\n"),
        tools,
        customTools: edits.customTools,
        runtime: deps.runtime,
        models: deps.models,
        modelOverride: deps.modelOverrides?.[resumeEditorRole.name],
        signal: deps.signal,
        retry: deps.retry,
        onUsage: deps.onUsage,
      });
      const memoryProposals = await Promise.all((output.memory ?? []).map((entry) => proposeMemory(ws, entry, "chat")));
      const refusal = (reply: string, lint: Finding[] = []): ResumeChatReply => ({
        reply,
        changes: edits.changes,
        memoryProposals,
        ops: [],
        applied: edits.shas.length > 0,
        sha: edits.shas.at(-1) ?? null,
        changedBullets: [],
        metadata: { lint, blocking: lint.filter((finding) => finding.severity === "block") },
      });
      if (!output.ops.length) return refusal(output.summary);
      const template = await loadTemplate(
        [resolveInWorkspace(ws.root, "templates"), join(ws.bundledDir, "templates")],
        resume.template,
      );
      let result: ReturnType<typeof applyOps>;
      try {
        if (output.ops.some((op) => op.op === "bullet.override"))
          throw new OpError("invalid", "Only the user can record an evidence override.");
        result = applyOps(resume, output.ops, {
          by: "ai",
          index: ctx.index,
          template: template.meta,
          now: () => new Date().toISOString(),
        });
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
        return refusal(
          error.code === "locked"
            ? "That change touches a locked line. Unlock it first, or ask me to edit an unlocked line."
            : `I could not apply that change: ${error.message} Ask for a smaller edit using existing evidence.`,
        );
      }
      const changed = new Set(result.changedBullets);
      const rewritten = new Set<string>();
      for (const op of output.ops) {
        if (op.op === "bullet.edit") rewritten.add(op.id);
        if (op.op === "variant.swap") rewritten.add(op.bulletId);
      }
      const previousBullets = new Map(
        resume.sections.flatMap((section) =>
          section.items.flatMap((item) => item.bullets.map((bullet) => [bullet.id, bullet] as const)),
        ),
      );
      for (const section of result.resume.sections)
        for (const item of section.items)
          for (const bullet of item.bullets)
            if (rewritten.has(bullet.id)) {
              if (previousBullets.get(bullet.id)?.text === bullet.text) rewritten.delete(bullet.id);
              else delete bullet.override;
            }
      const honestDraft = structuredClone(result.resume);
      for (const section of honestDraft.sections)
        for (const item of section.items)
          for (const bullet of item.bullets)
            if (rewritten.has(bullet.id) || !previousBullets.has(bullet.id)) {
              // A prior user override cannot authorize a new AI-written number.
              delete bullet.override;
              bullet.origin = "ai";
              bullet.hidden = false;
              item.hidden = false;
              section.hidden = false;
            }
      const unsupported = lintResume(honestDraft, { index: ctx.index, pack, rules: ctx.rules }).filter(
        (finding) =>
          finding.severity === "block" &&
          finding.bulletId &&
          changed.has(finding.bulletId) &&
          ["unsourced-number", "missing-claims", "unknown-claim"].includes(finding.rule),
      );
      if (unsupported.length)
        return refusal(
          "I cannot add facts or numbers without supporting evidence. What did you actually do or measure?",
          unsupported,
        );
      deps.signal?.throwIfAborted();
      if ((await fileHash(ws.root, rel)) !== expected)
        throw new ChatConflictError("stale-hash", "Resume changed during this request. Reload before trying again.");
      const lint = lintResume(result.resume, { index: ctx.index, pack, rules: ctx.rules }).filter(
        (finding) => !finding.bulletId || changed.has(finding.bulletId),
      );
      const blocking = lint.filter((finding) => finding.severity === "block");
      const reviewText = await optionalText(ws.root, `${prefix}/review.json`);
      const paths = [rel];
      if (reviewText) {
        const previous = Review.parse(JSON.parse(reviewText));
        const review = Review.parse({
          ...previous,
          done: false,
          render: null,
          checks: previous.checks.filter((note) => !changed.has(note.bulletId)),
          overrides: previous.overrides.filter((note) => !rewritten.has(note.bulletId)),
          lint: [...previous.lint.filter((finding) => finding.bulletId && !changed.has(finding.bulletId)), ...lint],
          blocking: ["Resume changed; checking and rendering required."],
        });
        await writeTextAtomic(ws.root, `${prefix}/review.json`, `${JSON.stringify(review, null, 2)}\n`);
        paths.push(`${prefix}/review.json`);
      }
      await writeTextAtomic(ws.root, rel, `${JSON.stringify(result.resume, null, 2)}\n`);
      const sha = await commitPaths(ws.root, paths, "Apply resume chat edits", "editor");
      return {
        reply: blocking.length
          ? `${output.summary} Some changed lines still need supporting evidence.`
          : output.summary,
        memoryProposals,
        changes: [...edits.changes, ...fieldChanges(resume, result.resume)],
        ops: output.ops,
        applied: true,
        sha,
        changedBullets: result.changedBullets,
        metadata: { lint, blocking },
      };
    } finally {
      ctx.search.close();
    }
  } finally {
    release();
  }
}
