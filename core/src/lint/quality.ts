import { type Finding, type Resume, visibleBullets } from "@vita/shared";
import type { ClaimIndex } from "../claims/index.js";

const words = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
export function sharedWordRun(left: string, right: string, length = 8): boolean {
  const a = words(left);
  const b = words(right);
  const spans = new Set(a.slice(0, Math.max(0, a.length - length + 1)).map((_, i) => a.slice(i, i + length).join(" ")));
  return b.some((_, i) => i + length <= b.length && spans.has(b.slice(i, i + length).join(" ")));
}
const contains = (text: string, term: string) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
};

/** Style findings never prevent editing or downloading an approved resume. */
export function lintQuality(resume: Resume, index: ClaimIndex, ranking?: string[]): Finding[] {
  const findings: Finding[] = [];
  const warn = (rule: string, message: string, bulletId?: string) =>
    findings.push({ rule, message, bulletId, severity: "warn" });
  if (!resume.header.headline?.trim()) warn("headline-present", "Give this resume a headline tailored to its target.");
  const sections = resume.sections.filter((section) => !section.hidden);
  const summary = sections
    .filter((section) => section.kind === "summary")
    .flatMap((section) => [
      section.text ?? "",
      ...section.items
        .filter((item) => !item.hidden)
        .flatMap((item) => item.bullets.filter((bullet) => !bullet.hidden).map((bullet) => bullet.text)),
    ])
    .join(" ");
  const skills = sections
    .filter((section) => section.kind === "list")
    .flatMap((section) =>
      section.items
        .filter((item) => !item.hidden)
        .flatMap((item) => [
          item.title,
          ...item.bullets.filter((bullet) => !bullet.hidden).map((bullet) => bullet.text),
        ]),
    )
    .join(" ");
  // Source stack is vocabulary data; the engine has no profession-specific technology list.
  const terms = new Set([...index.items.values()].flatMap((item) => item.meta.stack));
  for (const term of terms)
    if (contains(summary, term) && !contains(skills, term))
      warn("skills-cover-summary", `Include ${term}, named in the summary, in Skills using its existing source claim.`);
  for (const bullet of visibleBullets(resume)) {
    const receipts = bullet.claims.flatMap((id) => index.claims.get(id)?.evidence ?? []);
    if (receipts.some((receipt) => receipt.text && sharedWordRun(bullet.text, receipt.text)))
      warn(
        "verbatim-evidence",
        "Rewrite this copied evidence or statement in natural resume wording without changing its facts.",
        bullet.id,
      );
  }
  for (const section of sections.filter((section) => section.kind === "entries")) {
    let previous = -1;
    for (const item of section.items.filter((item) => !item.hidden)) {
      const slugs = item.bullets.flatMap((bullet) =>
        bullet.claims.flatMap((id) => index.claims.get(id)?.itemSlug ?? []),
      );
      const sourceSlug = item.source?.replace(/^(?:projects|outline)(?:\.md)?[#:/]/, "");
      const source = index.items.get(sourceSlug ?? "") ?? index.items.get(item.id) ?? index.items.get(slugs[0] ?? "");
      if (source?.meta.period?.trim() && !item.period?.trim())
        warn("known-period", `Show the known dates for ${item.title}.`);
      if (source && typeof source.meta.purpose === "string" && source.meta.purpose.trim() && !item.subtitle?.trim())
        warn("purpose-subtitle", `Add the known purpose of ${item.title} as its subtitle.`);
      const rank = ranking?.indexOf(source?.slug ?? "") ?? -1;
      if (source?.meta.kind === "project" && rank >= 0) {
        if (rank < previous) warn("project-fit-order", "Order projects by the supplied relevance ranking.");
        previous = rank;
      }
    }
  }
  return findings;
}
