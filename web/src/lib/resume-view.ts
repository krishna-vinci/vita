import type { Bullet, Resume, Review } from "@vita/shared";

/** Plain-word steps shown while a job runs. */
export const progressSteps = [
  "Reading the job",
  "Picking your best evidence",
  "Writing",
  "Checking every line",
  "Making the PDF",
] as const;

const stageStep: Record<string, number> = {
  analyse: 0,
  gaps: 0,
  select: 1,
  write: 2,
  revise: 2,
  lint: 3,
  check: 3,
  render: 4,
  ats: 4,
  save: 4,
  done: 4,
};

export function progressStep(progress: string): number {
  const stage = progress.split(":")[0]?.trim() ?? "";
  return stageStep[stage] ?? -1;
}

export interface Flag {
  /** "number" highlights just the figure; "line" highlights the whole line. */
  kind: "number" | "line";
  raw?: string;
  reason: string;
  /** Technical wording, shown only under "Show details". */
  detail: string;
}

/** One soft flag per line that blocks export and has not been vouched for. */
export function flagsFor(resume: Resume, review: Review | null): Map<string, Flag> {
  const flags = new Map<string, Flag>();
  if (!review) return flags;
  const attested = new Set<string>();
  for (const section of resume.sections)
    for (const item of section.items)
      for (const bullet of item.bullets) if (bullet.override || bullet.hidden) attested.add(bullet.id);
  for (const finding of review.lint) {
    if (finding.severity !== "block" || !finding.bulletId || attested.has(finding.bulletId)) continue;
    const raw =
      finding.rule === "unsourced-number" ? /Number "(.+?)" has no support/.exec(finding.message)?.[1] : undefined;
    const existing = flags.get(finding.bulletId);
    if (existing?.kind === "number" && !raw) continue;
    flags.set(finding.bulletId, {
      kind: raw ? "number" : "line",
      raw,
      reason: raw
        ? "I couldn't find this number in your projects. Numbers help, but only real ones."
        : "This line may say more than your notes support.",
      detail: `${finding.rule}: ${finding.message}`,
    });
  }
  for (const note of review.checks) {
    if (note.verdict === "supported" || attested.has(note.bulletId) || flags.has(note.bulletId)) continue;
    flags.set(note.bulletId, {
      kind: "line",
      reason: "This line may say more than your notes support.",
      detail: `${note.verdict}: ${note.reason}`,
    });
  }
  return flags;
}

/** Split text around the first occurrence of `raw`, for highlighting a figure. */
export function splitAround(text: string, raw: string | undefined): [string, string, string] | null {
  if (!raw) return null;
  const at = text.indexOf(raw);
  return at < 0 ? null : [text.slice(0, at), raw, text.slice(at + raw.length)];
}

export function allBullets(resume: Resume): Bullet[] {
  return resume.sections.flatMap((section) => section.items.flatMap((item) => item.bullets));
}

export interface SourceClaim {
  text: string;
  evidence: { id: string; text: string }[];
}

/** Best-effort read of claim and evidence text from outline.md and projects.md for "Show details". */
export function parseClaims(...markdown: string[]): Map<string, SourceClaim> {
  const claims = new Map<string, SourceClaim>();
  const evidenceText = new Map<string, string>();
  for (const md of markdown) {
    for (const match of md.matchAll(/^\s*-\s+id:\s*(\S+)\s*\n(?:\s+\w+:.*\n)*?\s+text:\s*"(.*)"\s*$/gm)) {
      if (match[1] && match[2]) evidenceText.set(match[1], match[2]);
    }
  }
  for (const md of markdown) {
    for (const match of md.matchAll(/^\s*-\s+(.+?)\s*<!--\s*c:(\S+?)(?:\s+ev:(\S+?))?\s*-->/gm)) {
      const [, text, id, ev] = match;
      if (!id || !text || claims.has(id)) continue;
      const evidence = ev ? ev.split(",").map((evId) => ({ id: evId, text: evidenceText.get(evId) ?? "" })) : [];
      claims.set(id, { text, evidence });
    }
  }
  return claims;
}

export function resumeToMarkdown(resume: Resume): string {
  const lines = [`# ${resume.header.name}`];
  if (resume.header.headline) lines.push("", resume.header.headline);
  const contact = resume.header.contact.map((entry) => entry.value).filter(Boolean);
  if (contact.length) lines.push("", contact.join(" | "));
  for (const section of resume.sections) {
    if (section.hidden) continue;
    lines.push("", `## ${section.title}`);
    if (section.text) lines.push("", section.text);
    for (const item of section.items) {
      if (item.hidden) continue;
      const heading = [item.title, item.subtitle].filter(Boolean).join(", ");
      const when = [item.period, item.location].filter(Boolean).join(" | ");
      if (heading) lines.push("", `### ${heading}${when ? ` (${when})` : ""}`, "");
      for (const bullet of item.bullets) if (!bullet.hidden) lines.push(`- ${bullet.text}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function download(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
}

/** Same whole-word, case-insensitive rule the engine uses to decide a keyword is present. */
export function keywordMatches(text: string, keyword: string): boolean {
  if (!keyword.trim()) return false;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** Everything a reader sees on the resume: titles, summaries, visible lines. */
export function visibleText(resume: Resume): string {
  return resume.sections
    .filter((section) => !section.hidden)
    .flatMap((section) => [
      section.title,
      section.text ?? "",
      ...section.items
        .filter((item) => !item.hidden)
        .flatMap((item) => [
          item.title,
          item.subtitle ?? "",
          ...item.bullets.filter((b) => !b.hidden).map((b) => b.text),
        ]),
    ])
    .join("\n");
}

export function requirementCovered(text: string, keywords: string[][]): boolean {
  return keywords.length > 0 && keywords.every((group) => group.some((keyword) => keywordMatches(text, keyword)));
}
