import { type CheckNote, type Resume, type Rules, visibleBullets } from "@vita/shared";
import type { ClaimIndex } from "../claims/index.js";
import { extractNumbers } from "../lint/numbers.js";
import { statementOnlyNumbers } from "../lint/rules.js";
import { assignOutlineAnchors, parseOutline } from "../source/index.js";
import type { Base, Context } from "./context.js";
import type { GenerationInput } from "./generate.js";

export function baseSummaries(bases: Base[]) {
  return bases.map(({ id, config, resume }) => ({
    id,
    name: config.name,
    packs: config.packs,
    topSkills: [
      ...new Set([
        ...config.emphasis.skills_first,
        ...resume.sections
          .filter((section) => !section.hidden && section.kind === "list")
          .flatMap((section) =>
            section.items
              .filter((item) => !item.hidden)
              .flatMap((item) => [
                item.title,
                ...item.bullets.filter((bullet) => !bullet.hidden).map((bullet) => bullet.text),
              ]),
          ),
      ]),
    ]
      .filter(Boolean)
      .slice(0, 20),
    itemTitles: resume.sections
      .filter((section) => !section.hidden)
      .flatMap((section) => section.items.filter((item) => !item.hidden).map((item) => item.title)),
  }));
}

/** Include selected receipts, plus every seed/must-cover/answer claim even when it missed the selection cap. */
export function writerEvidence(ctx: Context, input: GenerationInput) {
  const variantIds = input.selection
    ? input.selection.items.flatMap((item) => item.variantIds)
    : [...ctx.index.variants.keys()];
  const ids = new Set([
    ...(ctx.index.claims.has("outline.summary") ? ["outline.summary"] : []),
    ...(input.selection?.claimIds ?? ctx.index.claims.keys()),
    ...variantIds,
    ...(input.seed ? visibleBullets(input.seed).flatMap((bullet) => bullet.claims) : []),
    ...(input.mustCover?.flatMap((requirement) => requirement.claimIds) ?? []),
    ...(input.answerClaims?.map((claim) => claim.id) ?? []),
  ]);
  const claims = [...ids].map((id) => ctx.index.claims.get(id) ?? { id, missing: true });
  const itemSlugs = new Set(claims.flatMap((claim) => ("itemSlug" in claim && claim.itemSlug ? [claim.itemSlug] : [])));
  const items = [...itemSlugs].flatMap((slug) => {
    const item = ctx.index.items.get(slug);
    if (!item) return [];
    const { evidence: _evidence, ...meta } = item.meta;
    return [{ slug, name: item.name, meta, limits: item.limits }];
  });
  const outlineItems = parseOutline(assignOutlineAnchors(ctx.outlineText).markdown).sections.flatMap((section) =>
    section.entries
      .filter((entry) => entry.bullets.some((bullet) => bullet.claimId && ids.has(bullet.claimId)))
      .map((entry) => ({
        section: section.title,
        title: entry.title,
        body: entry.body,
        claimIds: entry.bullets.flatMap((bullet) =>
          bullet.claimId && ids.has(bullet.claimId) ? [bullet.claimId] : [],
        ),
      })),
  );
  return { claims, outlineItems, variants: variantIds.flatMap((id) => ctx.index.variants.get(id) ?? []), items };
}

/** No truncation: each visible line carries all cited claims, metrics, linked evidence and limits. */
export function checkerContext(resume: Resume, index: ClaimIndex) {
  return resume.sections
    .filter((section) => !section.hidden)
    .flatMap((section) =>
      section.items
        .filter((item) => !item.hidden)
        .flatMap((item) => {
          const { bullets: _bullets, ...parent } = item;
          return item.bullets
            .filter((bullet) => !bullet.hidden)
            .map((bullet) => ({
              bullet,
              section: { id: section.id, title: section.title, kind: section.kind },
              item: parent,
              claims: bullet.claims.map((id) => index.claims.get(id) ?? { id, missing: true }),
              ownership: [...new Set(bullet.claims.flatMap((id) => index.claims.get(id)?.itemSlug ?? []))].map(
                (slug) => ({
                  itemSlug: slug,
                  relationship: index.items.get(slug)?.meta.relationship ?? "unknown",
                  contribution: index.items.get(slug)?.meta.contribution,
                }),
              ),
            }));
        }),
    );
}

/** In-memory verdicts only: keys contain the full source basis and are invalidated on checker-model changes. */
export class VerdictCache {
  readonly #supported = new Map<string, CheckNote>();
  #model: string | undefined;

  useModel(model: string) {
    if (this.#model !== model) this.#supported.clear();
    this.#model = model;
  }

  // Parent context is part of the key too: moving an identical line may overstate who/where it describes.
  private key(entry: ReturnType<typeof checkerContext>[number]) {
    return JSON.stringify([
      entry.bullet.text,
      [...entry.bullet.claims].sort(),
      entry.item,
      entry.section,
      entry.ownership,
      [...entry.claims].sort((a, b) => a.id.localeCompare(b.id)),
    ]);
  }

  partition(resume: Resume, index: ClaimIndex) {
    const cached: CheckNote[] = [];
    const pending = new Set<string>();
    for (const entry of checkerContext(resume, index)) {
      const note = this.#supported.get(this.key(entry));
      if (note) cached.push({ ...note, bulletId: entry.bullet.id });
      else pending.add(entry.bullet.id);
    }
    const selected = structuredClone(resume);
    for (const section of selected.sections)
      for (const item of section.items) item.bullets = item.bullets.filter((bullet) => pending.has(bullet.id));
    return { cached, pending, selected };
  }

  remember(resume: Resume, index: ClaimIndex, notes: CheckNote[]) {
    for (const entry of checkerContext(resume, index)) {
      const verdicts = notes.filter((note) => note.bulletId === entry.bullet.id);
      const key = this.key(entry);
      if (verdicts.length === 1 && verdicts[0]?.verdict === "supported") this.#supported.set(key, verdicts[0]);
      else this.#supported.delete(key);
    }
  }
}

/** Attach receipt labels and effective warning severity without changing the checker verdict. */
export function reviewChecks(
  checks: CheckNote[],
  resume: Resume,
  index: ClaimIndex,
  honesty: Rules["honesty"],
): CheckNote[] {
  const bullets = new Map(visibleBullets(resume).map((bullet) => [bullet.id, bullet]));
  return checks.map((note) => {
    const ids = bullets.get(note.bulletId)?.claims ?? [];
    const claims = ids.flatMap((id) => index.claims.get(id) ?? []);
    const estimates = statementOnlyNumbers(claims);
    const estimatedNumber = extractNumbers(bullets.get(note.bulletId)?.text ?? "").some((number) =>
      estimates.has(number.norm),
    );
    const statement =
      claims.length === ids.length &&
      claims.length > 0 &&
      claims.every(
        (claim) => claim.evidence.length > 0 && claim.evidence.every((receipt) => receipt.kind === "statement"),
      );
    return {
      ...note,
      ...(statement || estimatedNumber ? { basis: "statement" as const } : {}),
      ...(note.verdict !== "supported" && (honesty === "trust" || note.severity !== undefined)
        ? { severity: honesty === "trust" ? ("warn" as const) : ("block" as const) }
        : {}),
    };
  });
}
