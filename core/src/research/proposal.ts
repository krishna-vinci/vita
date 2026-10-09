import { type Evidence, type EvidenceSubmission, SourceProposal, slugify } from "@vita/shared";
import { isMap, isNode, isSeq, parseDocument, stringify } from "yaml";
import { type ProjectsItem, parseProjects, serializeProjects, writeAnchor } from "../source/index.js";
import { fenceEnd, fenceStart, heading, sourceLines, uniqueId } from "../source/markdown.js";
import { newProjectsItem } from "../source/projects.js";

function prose(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
const allocate = uniqueId;

/** Insert only new evidence; keep all existing YAML spelling, comments and scalar bytes. */
function addEvidence(section: string, evidence: Evidence[], eol: string): string {
  if (!evidence.length) return section;
  let marker: string | undefined;
  let start: number | undefined;
  let end: number | undefined;
  let cursor = 0;
  for (const line of sourceLines(section)) {
    if (marker) {
      if (fenceEnd(line.text, marker)) {
        if (start !== undefined) {
          end = cursor;
          break;
        }
        marker = undefined;
      }
    } else {
      const fence = fenceStart(line.text);
      if (fence) {
        marker = fence.marker;
        if (fence.info === "yaml") start = cursor + line.text.length + line.ending.length;
      }
    }
    cursor += line.text.length + line.ending.length;
  }
  if (start === undefined) {
    const first = sourceLines(section)[0];
    const offset = (first?.text.length ?? 0) + (first?.ending.length ?? 0);
    const metadata = stringify({ evidence }, { lineWidth: 0 }).replaceAll("\n", eol);
    return `${section.slice(0, offset)}${first?.ending ? "" : eol}\`\`\`yaml${eol}${metadata}\`\`\`${eol}${section.slice(offset)}`;
  }
  if (end === undefined) throw new Error("Existing item metadata fence is unclosed");
  const yaml = section.slice(start, end);
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error("Existing item metadata is invalid");
  const node = doc.get("evidence", true);
  let offset: number;
  let addition: string;
  if (node === undefined) {
    if (isMap(doc.contents) && doc.contents.flow && doc.contents.range) {
      offset = doc.contents.range[1] - 1;
      addition = `${doc.contents.items.length ? ", " : ""}"evidence": ${JSON.stringify(evidence)}`;
    } else {
      offset = yaml.length;
      addition = stringify({ evidence }, { lineWidth: 0 });
    }
  } else if (isSeq(node) && node.range) {
    if (node.flow) {
      offset = node.range[1] - 1;
      const separator = node.items.length && !yaml.slice(0, offset).trimEnd().endsWith(",") ? ", " : " ";
      addition = `${separator}${evidence.map((ev) => JSON.stringify(ev)).join(", ")}`;
    } else {
      offset = node.range[2];
      const first = node.items[0];
      const itemStart = isNode(first) ? first.range?.[0] : undefined;
      const lineStart = itemStart === undefined ? 0 : yaml.lastIndexOf("\n", itemStart - 1) + 1;
      const indent = /^ */.exec(yaml.slice(lineStart))?.[0] ?? "  ";
      addition = stringify(evidence, { lineWidth: 0 })
        .split("\n")
        .map((line) => (line ? indent + line : line))
        .join("\n");
    }
  } else throw new Error("Existing evidence must be a YAML list");
  addition = addition.replaceAll("\n", eol);
  return section.slice(0, start + offset) + addition + section.slice(start + offset);
}

function appendSubsection(section: string, name: string, lines: string[], eol: string): string {
  if (!lines.length) return section;
  let marker: string | undefined;
  let found = false;
  let offset = section.length;
  let cursor = 0;
  for (const line of sourceLines(section)) {
    if (marker) {
      if (fenceEnd(line.text, marker)) marker = undefined;
    } else {
      const fence = fenceStart(line.text);
      if (fence) marker = fence.marker;
      else {
        const title = heading(line.text, 3);
        if (found && title !== null) {
          offset = cursor;
          break;
        }
        if (title === name) found = true;
      }
    }
    cursor += line.text.length + line.ending.length;
  }
  if (marker) {
    section += `${section.endsWith("\n") ? "" : eol}${marker}${eol}`;
    offset = section.length;
  }
  if (!found) return `${section}${section.endsWith("\n") ? "" : eol}${eol}### ${name}${eol}${lines.join(eol)}${eol}`;
  return `${section.slice(0, offset)}${section.slice(0, offset).endsWith("\n") ? "" : eol}${lines.join(eol)}${eol}${section.slice(offset)}`;
}

export function evidenceProposal(
  markdown: string,
  baseHash: string,
  submission: EvidenceSubmission,
  itemSlug?: string,
  at = new Date().toISOString().slice(0, 10),
): SourceProposal | null {
  const { doc, issues } = parseProjects(markdown);
  const slug = itemSlug ?? submission.item.slug ?? slugify(submission.item.name);
  const matches = doc.items.filter((item) => item.slug === slug);
  if (matches.length > 1) throw new Error("Research item slug is ambiguous");
  const existing = matches[0];
  if (itemSlug && !existing) throw new Error(`Research item not found: ${itemSlug}`);
  if (
    existing &&
    issues.some(
      (issue) =>
        issue.line >= existing.line && issue.line < (doc.items[doc.items.indexOf(existing) + 1]?.line ?? Infinity),
    )
  )
    throw new Error("Research item has invalid metadata; repair it before adding evidence");
  const used = new Set<string>(
    doc.items.flatMap((item) => [
      ...item.claims.map((claim) => claim.id),
      ...item.variants.map((variant) => variant.id),
      ...item.meta.evidence.map((ev) => ev.id),
    ]),
  );
  const added: ProjectsItem = newProjectsItem(existing?.name ?? submission.item.name, 1);
  added.meta = {
    kind: submission.item.kind,
    links: submission.item.links,
    stack: submission.item.stack,
    ...(submission.item.period ? { period: submission.item.period } : {}),
    evidence: [],
  };
  for (const claim of submission.claims) {
    if (existing?.claims.some((prior) => prior.text === prose(claim.text))) continue;
    const id = allocate(`${slug}-research`, used);
    const evidence = claim.evidence.map((receipt) => ({ ...receipt, id: allocate(`ev-${slug}-research`, used), at }));
    added.meta.evidence.push(...evidence);
    added.claims.push({ id, text: prose(claim.text), evidence: evidence.map((ev) => ev.id), metrics: [] });
  }
  added.limits = submission.limits.map(prose).filter((limit) => !existing?.limits.includes(limit));
  added.variants = submission.variants
    .filter((variant) => !existing?.variants.some((prior) => prior.text === prose(variant.text)))
    .map((variant) => ({
      id: allocate(`${slug}-research-variant`, used),
      label: prose(variant.label),
      text: prose(variant.text),
    }));
  const notes = submission.notes.map((note) => `- ${prose(note)}`);
  if (!added.claims.length && !added.limits.length && !added.variants.length && !notes.length) return null;
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  let after: string;
  if (existing) {
    const lines = markdown.split(/(?<=\n)/);
    const start = lines.slice(0, existing.line - 1).join("").length;
    const next = doc.items[doc.items.indexOf(existing) + 1];
    const end = next ? lines.slice(0, next.line - 1).join("").length : markdown.length;
    let section = addEvidence(markdown.slice(start, end), added.meta.evidence, eol);
    section = appendSubsection(
      section,
      "Claims",
      added.claims.map((claim) => writeAnchor(`- ${claim.text}`, { claim: claim.id, evidence: claim.evidence })),
      eol,
    );
    section = appendSubsection(
      section,
      "Limits",
      added.limits.map((limit) => `- ${limit}`),
      eol,
    );
    section = appendSubsection(
      section,
      "Variants",
      added.variants.map((variant) =>
        writeAnchor(`- ${variant.label}: ${variant.text}`, { variant: variant.id, evidence: [] }),
      ),
      eol,
    );
    section = appendSubsection(section, "Research notes", notes, eol);
    after = markdown.slice(0, start) + section + markdown.slice(end);
  } else {
    if (notes.length) added.extra = ["### Research notes", ...notes];
    after = `${markdown}${markdown.endsWith("\n") ? "" : eol}${eol}${serializeProjects({ preamble: [], items: [added] }).replaceAll("\n", eol)}`;
  }
  return SourceProposal.parse({
    file: "projects",
    before: markdown,
    after,
    baseHash,
    summary: `Research evidence: ${added.name}`,
  });
}
