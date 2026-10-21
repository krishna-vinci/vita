import { Evidence } from "@vita/shared";
import { parse } from "yaml";
import { readAnchor } from "./anchors";
import { bulletText, factId, fenceEnd, fenceStart, heading, sourceLines } from "./markdown";

export interface OutlineBullet {
  line: number;
  text: string;
  claimId: string | null;
  evidence?: Evidence[];
}
export interface OutlineEntry {
  title: string;
  line: number;
  bullets: OutlineBullet[];
  body: string[];
}
export interface OutlineSection {
  title: string;
  line: number;
  entries: OutlineEntry[];
  bullets: OutlineBullet[];
  body: string[];
}
export interface Outline {
  preamble: string[];
  sections: OutlineSection[];
  raw: string;
  summary?: { text: string; claimIds: string[] };
}

export const summarySectionNames = ["summary", "professional summary", "profile"];

export function parseOutline(markdown: string): Outline {
  const outline: Outline = { preamble: [], sections: [], raw: markdown };
  let section: OutlineSection | undefined;
  let entry: OutlineEntry | undefined;
  let fence: string | undefined;
  sourceLines(markdown).forEach(({ text }, index) => {
    const body = entry?.body ?? section?.body ?? outline.preamble;
    if (fence) {
      body.push(text);
      if (fenceEnd(text, fence)) fence = undefined;
      return;
    }
    const start = fenceStart(text);
    if (start) {
      fence = start.marker;
      body.push(text);
      return;
    }
    const sectionTitle = heading(text, 2);
    const entryTitle = heading(text, 3);
    if (sectionTitle !== null) {
      section = { title: sectionTitle, line: index + 1, entries: [], bullets: [], body: [] };
      outline.sections.push(section);
      entry = undefined;
    } else if (entryTitle !== null && section) {
      entry = { title: entryTitle, line: index + 1, bullets: [], body: [] };
      section.entries.push(entry);
    } else {
      const bullet = bulletText(text);
      if (bullet !== null && section) {
        const parsed = readAnchor(bullet);
        (entry?.bullets ?? section.bullets).push({
          line: index + 1,
          text: parsed.text,
          claimId: parsed.anchor?.claim ?? null,
        });
      } else body.push(text);
    }
  });
  // Statement receipts live in fenced metadata next to the entry, outside user prose.
  for (const section of outline.sections)
    for (const entry of [section, ...section.entries]) {
      const body = entry.body.join("\n");
      for (const match of body.matchAll(/^```yaml\r?\n([\s\S]*?)^```\s*$/gm)) {
        try {
          const receipts = parse(match[1] ?? "")?.statement_claims;
          if (!Array.isArray(receipts)) continue;
          for (const receipt of receipts) {
            const bullet = entry.bullets.find((bullet) => bullet.claimId === receipt?.id);
            const parsed = Evidence.array().safeParse(receipt?.evidence);
            if (bullet && parsed.success) bullet.evidence = [...(bullet.evidence ?? []), ...parsed.data];
          }
        } catch {
          /* Unparsed user blocks stay in body. */
        }
      }
    }
  const summary = outline.sections.find((section) =>
    summarySectionNames.includes(readAnchor(section.title).text.trim().toLowerCase()),
  );
  if (summary) {
    const end = outline.sections.find((section) => section.line > summary.line)?.line;
    let fence: string | undefined;
    const claimIds = new Set<string>();
    const headingAnchor = readAnchor(summary.title).anchor?.claim;
    if (headingAnchor) claimIds.add(headingAnchor);
    const prose = sourceLines(markdown)
      .slice(summary.line, end === undefined ? undefined : end - 1)
      .flatMap(({ text }) => {
        if (fence) {
          if (fenceEnd(text, fence)) fence = undefined;
          return [];
        }
        const start = fenceStart(text);
        if (start) {
          fence = start.marker;
          return [];
        }
        const parsed = readAnchor(bulletText(text) ?? text);
        if (parsed.anchor?.claim) claimIds.add(parsed.anchor.claim);
        return [parsed.text];
      })
      .join("\n")
      .trim();
    if (prose) outline.summary = { text: prose, claimIds: [...claimIds] };
  }
  return outline;
}

export function assignOutlineAnchors(markdown: string): { markdown: string; added: number } {
  const outline = parseOutline(markdown);
  const used = new Set<string>();
  const bullets = new Map<number, { title: string; bullet: OutlineBullet }>();
  for (const section of outline.sections) {
    for (const bullet of section.bullets) bullets.set(bullet.line, { title: section.title, bullet });
    for (const entry of section.entries) {
      for (const bullet of entry.bullets) bullets.set(bullet.line, { title: entry.title, bullet });
    }
  }
  // Reserve anchors even outside recognized sections before assigning any new IDs.
  for (const { text } of sourceLines(markdown)) {
    const claim = readAnchor(text).anchor?.claim;
    if (claim) used.add(claim);
  }
  let added = 0;
  const anchored = sourceLines(markdown).map(({ text, ending }, index) => {
    const fact = bullets.get(index + 1);
    if (!fact || fact.bullet.claimId) return text + ending;
    const id = factId(fact.title, fact.bullet.text, used);
    const anchor = readAnchor(text).anchor;
    // Extend evidence-only or variant anchors without changing their existing bytes.
    const updated = anchor
      ? `${text.slice(0, text.lastIndexOf("<!--") + 4)} c:${id} ${text.slice(text.lastIndexOf("<!--") + 4)}`
      : `${text} <!-- c:${id} -->`;
    added++;
    return updated + ending;
  });
  return { markdown: anchored.join(""), added };
}
