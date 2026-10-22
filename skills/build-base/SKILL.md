---
name: build-base
description: Select and order an honest base resume from a master for a named career direction.
---

# Build a base resume

Read the master resume and the requested direction. Use the selected packs and
page budget to choose relevant items and order them for that direction.

- Use facts and claim IDs already present in the master and evidence inventory.
- Preserve locked bullets exactly, including their visibility and overrides.
- Use the current master supplied by the engine. Regenerate lines whose older
  locks the engine released after a source change.
- Cite `outline.summary` in the summary and use that outline text, trimming or
  reordering emphasis only. Preserve a protected local summary override until
  the outline becomes newer. Store summary content in bullets, not section.text.
- Prefer relevant, supported outcomes over generic activity descriptions.
- Keep contact information, qualifications and chronology accurate.
- Do not put URLs in an item's title, subtitle or location. Project links are added
  automatically from the evidence links when the resume is rendered.
- Reword only when the linked claims support the new wording.
- Never infer a skill, employer, metric or outcome from the direction's name.
- Keep missing facts as questions; pending answers are not approved evidence.
- Respect the template and page budget; use layout knobs within their ranges.
- Return the full proposed resume through submit_resume when available.
- Without that tool, return a complete resume proposal for user review.

The result is a base with parent master. A separate checker reviews every visible
bullet; the writer does not approve its own work.

Use `Item.subtitle` for a one-line purpose; keep role and organisation in the
entry title. Categorise skills in a `list`
section: each item's `title` names a category and its bullets list supported
skills. Avoid a single uncategorised list. Follow confirmed ownership and action
voice from write-bullets, and preserve the requested layout.section_order.

Tailor header.headline and project order to this direction. Use known periods and
one-line purpose subtitles for projects and roles. Lead 2–4 supported bullets with
value or results before engineering. Skills cover technologies in the summary.
Paraphrase evidence and statements; no eight-word copies or internal/meta bullets.
