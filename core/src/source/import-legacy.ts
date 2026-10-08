import type { Evidence } from "@vita/shared";
import { readAnchor } from "./anchors";
import { bulletText, factId, fenceEnd, fenceStart, heading, sourceLines, uniqueId } from "./markdown";
import { newProjectsItem, type ProjectsDoc, type ProjectsItem } from "./projects";

function references(text: string): string[] {
  const refs = [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1] ?? "");
  if (refs.length) return refs;
  return [...text.matchAll(/https?:\/\/[^\s<>]+/g)].map((match) => match[0].replace(/[.,;]+$/, ""));
}

function tableCells(line: string): string[] | null {
  if (!/^\s*\|.*\|\s*$/.test(line)) return null;
  return line
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

export function importLegacyProjects(markdown: string): { doc: ProjectsDoc; report: string[] } {
  const doc: ProjectsDoc = { preamble: [], items: [] };
  const report: string[] = [];
  const lines = sourceLines(markdown);
  const used = new Set<string>();
  for (const { text } of lines) {
    const anchor = readAnchor(text).anchor;
    if (anchor?.claim) used.add(anchor.claim);
    if (anchor?.variant) used.add(anchor.variant);
  }
  let item: ProjectsItem | undefined;
  let mode = "extra";
  let label: string | null = null;
  let fence: string | undefined;
  let evidenceTable = false;
  const keep = (text: string, line: number) => {
    (item?.extra ?? doc.preamble).push(text);
    if (text.trim()) report.push(`Line ${line}: kept as ${item ? "extra" : "preamble"}: ${text}`);
  };
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]?.text ?? "";
    const line = index + 1;
    if (fence) {
      keep(text, line);
      if (fenceEnd(text, fence)) fence = undefined;
      continue;
    }
    const start = fenceStart(text);
    if (start) {
      fence = start.marker;
      keep(text, line);
      continue;
    }
    const name = heading(text, 2);
    if (name !== null) {
      item = newProjectsItem(name, line);
      doc.items.push(item);
      mode = "extra";
      evidenceTable = false;
      report.push(`Line ${line}: mapped item ${name}`);
      continue;
    }
    if (!item) {
      keep(text, line);
      continue;
    }
    const bold = /^\*\*([^*]+?)\*\*(.*)$/.exec(text);
    if (bold) {
      const key = (bold[1] ?? "").replace(/:$/, "").trim();
      const value = (bold[2] ?? "").replace(/^:\s*/, "").trim();
      mode = "extra";
      evidenceTable = false;
      if (key === "Link" || key === "Live URL") {
        const refs = references(value);
        item.meta.links.push(...refs);
        if (refs.length) report.push(`Line ${line}: mapped ${key} to links`);
        // Keep labels, descriptions and markdown link titles not represented by URLs.
        if (!refs.length || value !== refs.join(", ")) keep(text, line);
      } else if (key === "Verified stack" || key === "Approved stack framing") {
        item.meta.stack.push(
          ...value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        );
        report.push(`Line ${line}: mapped ${key} to stack`);
      } else if (key === "Verification") {
        const at = /\b\d{4}-\d{2}-\d{2}\b/.exec(value)?.[0];
        const ref = /\bcommit\s+`([^`]+)`/i.exec(value)?.[1];
        if (at) {
          item.meta.verified = ref ? { at, ref } : { at };
          report.push(`Line ${line}: mapped Verification to verified`);
        }
        keep(text, line);
      } else if (key === "Verified highlights" || key === "Claim boundaries") {
        mode = key === "Verified highlights" ? "claims" : "limits";
        report.push(`Line ${line}: mapped ${key} to ${mode}`);
        if (value) keep(text, line);
      } else {
        const variants = /^Resume-ready bullets?(?:\s*[—–-]\s*(.+))?$/.exec(key);
        if (variants) {
          mode = "variants";
          label = variants[1] ?? null;
          report.push(`Line ${line}: mapped ${key} to variants`);
          if (value) keep(text, line);
        } else keep(text, line);
      }
      continue;
    }
    const cells = tableCells(text);
    if (cells?.[0] === "Claim" && cells[1]?.startsWith("Source")) {
      evidenceTable = true;
      mode = "extra";
      keep(text, line);
      continue;
    }
    if (evidenceTable && cells) {
      if (!cells.every((cell) => /^:?-+:?$/.test(cell))) {
        const claim = cells[0] ?? "";
        const source = cells[1] ?? "";
        const refs = references(source);
        if (claim && source) {
          const evidence: Evidence = {
            id: uniqueId(`ev-${item.slug}-${item.meta.evidence.length + 1}`, used),
            kind: refs.some((ref) => /\/blob\//.test(ref)) ? "code" : "link",
            ref: refs.length === 1 ? refs[0] : source,
            text: claim,
          };
          item.meta.evidence.push(evidence);
          report.push(`Line ${line}: mapped evidence row to ${evidence.id}`);
        }
      }
      // Keep every cell and link title, including multiple sources per row.
      keep(text, line);
      continue;
    }
    if (text.trim()) evidenceTable = false;
    if (heading(text, 3) !== null) mode = "extra";
    const bullet = bulletText(text);
    if (bullet?.trim() && mode === "claims") {
      const parsed = readAnchor(bullet);
      if (parsed.text) {
        const id = parsed.anchor?.claim ?? factId(item.name, parsed.text, used);
        item.claims.push({ id, text: parsed.text, evidence: parsed.anchor?.evidence ?? [], metrics: [] });
        report.push(`Line ${line}: mapped highlight to claim ${id}`);
        if (parsed.anchor?.variant) keep(text, line);
      } else keep(text, line);
    } else if (bullet?.trim() && mode === "variants") {
      const parsed = readAnchor(bullet);
      const id = parsed.anchor?.variant ?? uniqueId(`${item.slug}-variant-${item.variants.length + 1}`, used);
      item.variants.push({ id, label, text: parsed.text });
      report.push(`Line ${line}: mapped resume bullet to variant ${id}`);
      if (parsed.anchor?.claim || parsed.anchor?.evidence.length) keep(text, line);
    } else if (bullet?.trim() && mode === "limits") {
      item.limits.push(bullet);
      report.push(`Line ${line}: mapped boundary to limit`);
    } else keep(text, line);
  }
  return { doc, report };
}
