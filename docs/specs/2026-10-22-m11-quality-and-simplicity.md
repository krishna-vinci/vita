# M11: Recruiter-quality resumes, simple to use

Date: 2026-10-22. Status: approved by the owner ("make it as intuitive and effective as possible"). The principles of `2026-10-09-vita-design.md` §3 still bind (nothing invented; every claim has a receipt; the person's own word counts, per M10).

## Why
An independent review of a generated resume (owner's Rifa AI job) scored it 7/10:
- implementation described before purpose or value;
- no results;
- no timeline (no project dates, no graduation year);
- odd bullets ("all Python projects use FastAPI async code" was a chat statement pasted verbatim; Vita's "including locked ones, two rounds" was evidence text copied verbatim);
- a broad headline, and skills that don't match the summary.

The owner also finds Vita "too complex and rigid": it exposes its machinery (claims, evidence, locks, variants, honesty levels, two banners, outline/projects/master/base/job) instead of helping.

## Part 1: quality engine (M11-T1)
1. **Writing rules** (writer prompt, skills, lint):
   - **Every project and role entry**: dates (`period`) when known, and a one-line purpose ("what it is and who it's for") as the entry's `subtitle`, then 2-4 bullets. Value or result first, engineering second.
   - **Headline per resume**: tailored to the target (job analysis or base direction), e.g. "Backend Developer · Python, FastAPI & Go", via `header.headline` on the resume (`header.set` exists).
   - **Skills cover the summary**: every technology named in the summary appears in Skills. Lint warning, auto-fixed by the writer.
   - **Order**: projects ordered by fit to the job or direction.
   - **No verbatim evidence or statements**: bullet text must not copy long spans of evidence text or statement quotes. Lint: a shared run of 8 or more words with any cited evidence text or statement quote is a warning, sent back to the writer.
   - **No meta or filler bullets**: about the person in the third person, or tool-internal wording.
2. **Recruiter review role** (`reviewer`, a new role and skill):
   - After drafting and checks, a separate model grades the resume like a hiring reviewer. Output:
     ```ts
     {
       score: 1..10,
       summary,
       findings: [{ id, area: "purpose" | "results" | "timeline" | "wording" | "positioning" | "order" | "skills", severity, message, fix?: ResumeOp[] | { question } }],
     }
     ```
   - **Fixes are honest**: ops may only reword or reorder using existing claims, set metadata, or ask a `question`, which becomes a missing-facts question (point 3).
   - **The writer revises once** with the findings before the result is saved, so only one review/revise round. The review is stored in `review.json` as `recruiter`. The UI shows the score and the top findings with **Apply** (runs the ops) or **Answer** (the question).
   - Default model: the same as `checker`; configurable.
   - Cost and usage are recorded like the other roles.
3. **Missing facts, asked once and remembered:**
   - Project and role dates, graduation year or expected year, and real results (usage, workload, reliability, tests).
   - Detected from the source: an entry with no `period`, an education entry with no year, a project with no result-type claim.
   - Asked through the existing questions-first step for jobs. For bases and master, asked as a short pre-generation question list.
   - Answers are **saved to the source**: `period` in project meta or the outline entry line; a year in education; a result claim as `statement` evidence (M10). So they are never asked again.
   - A "skip" is remembered too (`meta.skipped: [dates|results]`), so the question doesn't come back.
4. **Live preview render:** `POST /api/(resumes|applications)/:id/preview` renders the current resume to a PDF **without** committing or certifying it (sandboxed compile; cached by resume hash, template and layout). It returns a URL. The UI uses it for the side-by-side preview.

## Part 2: simplicity (M11-T2 backend, then UI tasks)
1. **"My information" as structured data** (`GET/PUT /api/info`), parsed from and written back to `outline.md`, `projects.md` and `profile.yaml`:
   - Profile.
   - Roles (title, organisation, location, period, highlights).
   - Projects (name, period, purpose, links, stack, your role, highlights).
   - Education (degree, institution, year).
   - Certifications.

   Writes are surgical and preserve every other byte, claim anchor and evidence (same rules as the source writers in M10).
2. **UI** (separate tasks):
   - The resume screen shows the real PDF preview beside chat and the review card.
   - "My information" uses forms and cards (markdown stays available as an advanced view).
   - One banner ("Your info changed · Update resumes") instead of two.
   - "Base resumes" are renamed **Versions**.
   - The honesty setting moves under Advanced.
   - Evidence, locks and claims are hidden unless **Show details** is on.

## Acceptance
On a copy of the owner's data, with real models, the owner's Rifa AI job regenerated:
- the recruiter score is 8 or more;
- every project has a period and a purpose line once the owner has answered;
- the headline is tailored;
- skills cover the summary;
- no 8-word copies of evidence;
- no meta bullets.

The owner can edit a project's dates, purpose and links in a form, and see the PDF update beside the resume.
