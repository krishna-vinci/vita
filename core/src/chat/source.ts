import type { SourceChatReply } from "@vita/shared";
import { chatTools, type StatementConversation } from "../agent/chat-tools.js";
import { buildSystemPrompt, runRole, wrapUntrusted } from "../agent/index.js";
import { proposeMemory } from "../memory/index.js";
import { loadContext } from "../pipeline/context.js";
import { localDate } from "../pipeline/date.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { fileHash, readText } from "../workspace/index.js";
import { ChatConflictError, chatTask, locate, replacement } from "./context.js";
import { sourceEditorRole } from "./roles.js";

export async function proposeSourceEdit(
  ws: WorkspaceHandle,
  input: StatementConversation,
  deps: PipelineDeps,
  role: typeof sourceEditorRole = sourceEditorRole,
): Promise<SourceChatReply> {
  const hashes = { outline: await fileHash(ws.root, "outline.md"), projects: await fileHash(ws.root, "projects.md") };
  const ctx = await loadContext(ws);
  try {
    const snapshots = { outline: ctx.outlineText, projects: ctx.projectsText };
    for (const file of ["outline", "projects"] as const)
      if ((await fileHash(ws.root, `${file}.md`)) !== hashes[file])
        throw new ChatConflictError("stale-hash", "Source changed while loading. Request a fresh edit.");
    const tools = { root: ws.root, index: ctx.index, search: ctx.search };
    const edits = chatTools(ctx, input, deps, tools);
    // Check the anchor while the model can still fix it: a missing or repeated "before" goes back to
    // it as an invalid submission (up to three tries) instead of failing the person's chat turn.
    const checked: typeof role = {
      ...role,
      submitTool: {
        ...role.submitTool,
        output: role.submitTool.output.superRefine((value, issue) => {
          if (!value.proposal) return;
          const found = locate(snapshots[value.proposal.file], value.proposal.before);
          if (found.ok) return;
          issue.addIssue({
            code: "custom",
            path: ["proposal", "before"],
            message:
              found.reason === "repeated"
                ? `"before" appears more than once in ${value.proposal.file}.md. Include more surrounding text so it is unique.`
                : `"before" was not found in ${value.proposal.file}.md. Copy it character for character from the snapshot or read_${value.proposal.file}, including any <!-- ... --> markers, or choose a shorter exact span.`,
          });
        }),
      },
    };
    const result = await runRole({
      role: checked,
      root: ws.root,
      system: await buildSystemPrompt({
        role,
        root: ws.root,
        bundledDir: ws.bundledDir,
        chat: input.message,
        onWarning: (message) => deps.onProgress?.({ stage: "warning", message }),
        task: "Apply explicit metadata and verified statements using the chat tools. Other source edits are proposals for approval.",
      }),
      task: [
        chatTask(input.message, input.history),
        `Today is ${localDate(deps.now?.() ?? new Date())}. A statement the user makes in this chat is dated today: use that date for statement evidence and never ask for it. Turn relative dates ("last month", "last year") into months or years from today.`,
        `Honesty level: ${ctx.rules.honesty}. Metadata needs no receipts: use set_project_links or set_profile. In balanced/trust, record facts the person states using record_statement immediately. In strict, use ordinary source proposals. Ask one short question only when a needed fact is absent. Never ask for dated source evidence or send the person to another editor.`,
        "Return propose_edit with { reply, proposal, memory? }. For a lasting preference or decision explicitly stated by the user, propose a memory entry { text, kind }; these require approval and never become evidence. A proposal has file, before, after, summary. Copy before exactly from the supplied snapshot with enough context to be unique. Return proposal: null for questions or refusals.",
        wrapUntrusted("outline.md", snapshots.outline),
        wrapUntrusted("projects.md", snapshots.projects),
      ].join("\n\n"),
      tools,
      customTools: edits.customTools,
      runtime: deps.runtime,
      models: deps.models,
      modelOverride: deps.modelOverrides?.[role.name],
      signal: deps.signal,
      retry: deps.retry,
      onUsage: deps.onUsage,
    });
    const memoryProposals = await Promise.all((result.memory ?? []).map((entry) => proposeMemory(ws, entry, "chat")));
    if (!result.proposal)
      return {
        reply: result.reply,
        proposal: null,
        memoryProposals,
        changes: edits.changes,
        applied: edits.shas.length > 0,
        sha: edits.shas.at(-1) ?? null,
      };
    const edit = result.proposal;
    // Tool writes are already approved; later proposals must use the new snapshot and hash.
    if (edits.shas.length)
      for (const file of ["outline", "projects"] as const) {
        snapshots[file] = await readText(ws.root, `${file}.md`);
        hashes[file] = await fileHash(ws.root, `${file}.md`);
      }
    replacement(snapshots[edit.file], edit.before, edit.after);
    // Store the exact source span, so applying the proposal later matches byte for byte.
    const span = locate(snapshots[edit.file], edit.before);
    if (span.ok) edit.before = snapshots[edit.file].slice(span.start, span.end);
    const baseHash = hashes[edit.file];
    if (!baseHash) throw new ChatConflictError("stale-hash", "Source file is missing. Request a fresh edit.");
    return {
      reply: result.reply,
      proposal: { ...edit, baseHash },
      memoryProposals,
      changes: edits.changes,
      applied: edits.shas.length > 0,
      sha: edits.shas.at(-1) ?? null,
    };
  } finally {
    ctx.search.close();
  }
}

export { applySourceEdit } from "../source/edit.js";
