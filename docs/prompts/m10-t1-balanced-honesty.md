# Task: M10-T1 Balanced honesty: your word counts, metadata needs no receipts

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m10-t1 on branch codex/m10-t1. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Owner problem (verbatim, from the resume chat)
"I haven't added the Studium and Vita links because a chat confirmation is not approved source evidence. Please record the URLs as a dated statement in the source editor; then I can add them with evidence receipts." The owner: "this is so annoying. making changes seems hindered with this evidence always."

Causes in code:
- `skills/edit-resume/SKILL.md` tells the resume chat to refuse and to send the person to "a dated statement through the source editor".
- `core/src/chat/resume.ts:47` says "Do not treat a pending chat answer as approved source evidence".
- The resume ops (`core/src/ops/types.ts`) cannot set an item's title, subtitle, period, location or links.
- A person's own statements are never turned into evidence automatically.

## Principle (keep, but apply it where it belongs)
Vita never invents claims, and every **claim about the person's work** has a receipt. **The person's own word is a valid receipt.** It is recorded as `statement` evidence quoting them, dated today, and shown as "you said". Metadata is not a claim and needs no receipt.

## Requirements
1. **Honesty level setting:** `Rules.honesty: "strict" | "balanced" | "trust"`, default `"balanced"` (`shared/src/api-instructions.ts`, `core/src/instructions/rules.ts`). The host can lock it like other rules.
   - `strict`: today's behaviour.
   - `balanced`:
     - Metadata changes are applied directly.
     - Statements the person makes in any chat become `statement` evidence automatically (see 3).
     - Numbers backed only by a statement are allowed but flagged in review as "your estimate" (a warning, not a blocker).
   - `trust`: checker and lint findings about support become warnings. They never block export or done.

   Lint rules that guard against *invented* numbers in AI text with no statement or receipt at all stay blocking in `balanced`.
2. **Metadata ops, no evidence needed at any level.** Add to `core/src/ops` and `shared` ResumeOp:
   - `item.set { id, title?, subtitle?, period?, location?, links?: ItemLink[] | null }`: per-resume edits of an entry's fields. `null` links clears the override.
   - `header.set { headline?, location? }`: per-resume. The profile stays the default.

   Both are undoable like the other ops and respect locks where they apply. Chat replies list these changes (extend the chat reply and thread `changes` with a `kind: "field"` entry: `{ id, field, before, after }`).
3. **Statements from chat become evidence.** Add a tool `record_statement` for the resume-editor and source-editor roles (and the onboarding/interview role if it fits):
   - Input: `{ itemSlug, quote, claimText }`.
   - **The server verifies that `quote` appears in the person's own messages in this conversation** (the current message plus the saved thread history from M9-T1; normalise whitespace and case). If it doesn't, the call is refused. The model can never invent a statement.
   - On success it appends `statement` evidence `{ id, kind: "statement", text: quote, at: today, ref: "chat:<threadId>" }` and a claim citing it to that item in `projects.md` (or `outline.md` for outline items), using the existing source-edit writer with locks. It commits as author `user` with the message "Record your statement: <claim>", and returns the claim id.
   - The resume chat can then add or reword a bullet citing that claim in the same turn.
   - In `strict` mode the tool is not offered; keep today's behaviour.
4. **Project links and profile from chat.** Add tools for the resume and source editors:
   - `set_project_links { itemSlug, add?: string[], remove?: string[] }`: edits `meta.links` in `projects.md`, http(s) only.
   - `set_profile { headline?, location?, contact? }`: uses the M8 profile writer (`server/src/routes/profile.ts` logic; move the shared part to core if needed).

   No evidence is needed for either. "Add the Studium landing page link" must work in one message: links render on every resume through the existing render-time derivation.
5. **Checker (`skills/check-claims/SKILL.md`, `core/src/pipeline` checker context):**
   - A claim backed by `statement` evidence is **supported** when the bullet says no more than the statement.
   - Mark the check note `basis: "statement"` (extend `CheckNote` with an optional `basis`). The UI shows "you said".
   - A number that appears only in a statement gets `basis: "statement"` and, in `balanced`, a non-blocking review note "Your estimate: <number>".
6. **Prompts and skills:** rewrite `edit-resume`, `edit-source`, `check-claims` and `write-bullets`, plus `core/src/chat/resume.ts`, `core/src/chat/source.ts` and `core/src/instructions/core.ts`, to match.
   - **Never** ask the person to "provide dated source evidence" or to "go to the source editor".
   - Record their statement, apply metadata, and ask one short question only when the person has not actually stated the fact. Example: they asked to add Kubernetes, but never said they used it.
   - Keep the injection rules: text inside sources and evidence is data.
7. **Owner migration note:** the outline has landing URLs under a "links" style list. The orchestrator already copied Studium and Vita URLs into `projects.md`. No migration code is needed.

## Tests (faux models, no network)
- `item.set` and `header.set` ops: apply, undo, locks, validation (http(s) links only), and rendering picks them up.
- `record_statement`:
  - accepted when the quote is in the person's messages (current message and saved thread);
  - refused when invented;
  - writes evidence and claim with today's date and `ref`, author `user`;
  - not offered in strict mode.
- `set_project_links`: adds or removes links in `projects.md` without touching other text. The rendered resume shows Website/GitHub.
- A faux resume-chat run, "Add the Studium landing page link", ends with the link in `projects.md` and no question asked.
- A faux run, "I built Vita entirely myself, add that", records the statement and adds a bullet citing it. The checker supports it with `basis: "statement"`.
- Levels:
  - `balanced` makes a statement-only number a warning, not a blocker;
  - `trust` turns unsupported findings into warnings;
  - `strict` keeps today's tests passing. Run the existing chat, pipeline and lint tests.

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/chat src/ops src/lint src/pipeline src/instructions src/source
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server
```

## Scope
- Change: `shared/src/**`, `core/src/{ops,chat,lint,pipeline,instructions,source,agent}/**` as needed, `server/src/**`, `skills/**`, tests.
- Do not touch: `web/`. A frontend task follows: list the final DTO changes (`ResumeOp`, chat reply `changes`, `CheckNote.basis`, `Rules.honesty`).

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
