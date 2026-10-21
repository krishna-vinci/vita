---
name: build-base
description: Select and order an honest base resume from a master for a named career direction.
---

# Build a base resume

Read the master resume and the requested direction. Use the selected packs and
page budget to choose relevant items and order them for that direction.

- Use facts and claim IDs already present in the master and evidence inventory.
- Preserve locked bullets exactly, including their visibility and overrides.
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

Use `Item.subtitle` for experience role lines. Categorise skills in a `list`
section: each item's `title` names a category and its bullets list supported
skills. Avoid a single uncategorised list. Follow confirmed ownership and action
voice from write-bullets, and preserve the requested layout.section_order.
