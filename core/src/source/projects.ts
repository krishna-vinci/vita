import { isDeepStrictEqual } from "node:util";
import { type Claim, ItemMeta, slugify } from "@vita/shared";
import { parseDocument, stringify } from "yaml";
import { readAnchor, writeAnchor } from "./anchors";
import { bulletText, factId, fenceEnd, fenceStart, heading, sourceLines, uniqueId } from "./markdown";

export interface ProjectsItem {
  name: string;
  slug: string;
  meta: ItemMeta;
  claims: Claim[];
  limits: string[];
  variants: { id: string; label: string | null; text: string }[];
  extra: string[];
  line: number;
}
export interface ProjectsDoc {
  preamble: string[];
  items: ProjectsItem[];
}
export interface ParseIssue {
  line: number;
  message: string;
}

export function newProjectsItem(name: string, line: number): ProjectsItem {
  return { name, slug: slugify(name), meta: ItemMeta.parse({}), claims: [], limits: [], variants: [], extra: [], line };
}

export function parseProjects(markdown: string): { doc: ProjectsDoc; issues: ParseIssue[] } {
  const doc: ProjectsDoc = { preamble: [], items: [] };
  const issues: ParseIssue[] = [];
  const lines = sourceLines(markdown);
  const used = new Set<string>();
  for (const { text } of lines) {
    const anchor = readAnchor(text).anchor;
    if (anchor?.claim) used.add(anchor.claim);
    if (anchor?.variant) used.add(anchor.variant);
  }
  let item: ProjectsItem | undefined;
  let mode = "extra";
  let metaSeen = false;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]?.text ?? "";
    const start = fenceStart(text);
    if (start) {
      const block = [text];
      const line = index + 1;
      let closed = false;
      while (++index < lines.length) {
        const next = lines[index]?.text ?? "";
        block.push(next);
        if (fenceEnd(next, start.marker)) {
          closed = true;
          break;
        }
      }
      if (item && start.info === "yaml" && !metaSeen) {
        metaSeen = true;
        try {
          if (!closed) throw new Error("Unclosed YAML fence");
          const yaml = parseDocument(block.slice(1, -1).join("\n"));
          if (yaml.errors.length) throw new Error(yaml.errors.map((error) => error.message).join("; "));
          const value: unknown = yaml.toJS({ maxAliasCount: 100 });
          const result = ItemMeta.safeParse(value);
          if (!result.success) throw new Error(result.error.message);
          item.meta = result.data;
          // Comments and schema-stripped nested fields are user text, too.
          const omitted = Object.entries(value as Record<string, unknown>).some(
            ([key, field]) => !isDeepStrictEqual(field, item?.meta[key]),
          );
          if (omitted || yaml.warnings.length || block.slice(1, -1).some((line) => /(^|\s)#/.test(line))) {
            item.extra.push(...block);
          }
        } catch (error) {
          issues.push({ line, message: error instanceof Error ? error.message : String(error) });
          item.extra.push(...block);
        }
      } else (item?.extra ?? doc.preamble).push(...block);
      continue;
    }
    const name = heading(text, 2);
    if (name !== null) {
      item = newProjectsItem(name, index + 1);
      doc.items.push(item);
      mode = "extra";
      metaSeen = false;
      continue;
    }
    if (!item) {
      doc.preamble.push(text);
      continue;
    }
    const subsection = heading(text, 3);
    if (subsection !== null) {
      mode = subsection;
      if (!["Claims", "Limits", "Variants"].includes(mode)) item.extra.push(text);
      continue;
    }
    const bullet = bulletText(text);
    if (bullet?.trim() && mode === "Claims") {
      const { text: claimText, anchor } = readAnchor(bullet);
      if (!claimText) {
        item.extra.push(text);
        continue;
      }
      item.claims.push({
        id: anchor?.claim ?? factId(item.name, claimText, used),
        text: claimText,
        evidence: anchor?.evidence ?? [],
        metrics: [],
      });
      if (anchor?.variant) item.extra.push(text);
    } else if (bullet?.trim() && mode === "Limits") {
      item.limits.push(bullet);
    } else if (bullet?.trim() && mode === "Variants") {
      const parsed = readAnchor(bullet);
      const labelled = /^([^:]+):[ \t]+(.*)$/.exec(parsed.text);
      item.variants.push({
        id: parsed.anchor?.variant ?? uniqueId(`${item.slug}-variant-${item.variants.length + 1}`, used),
        label: labelled?.[1] ?? null,
        text: labelled?.[2] ?? parsed.text,
      });
      if (parsed.anchor?.claim || parsed.anchor?.evidence.length) item.extra.push(text);
    } else item.extra.push(text);
  }
  return { doc, issues };
}

export function serializeProjects(doc: ProjectsDoc): string {
  // No implicit blank lines: every blank line retained in extra/preamble is emitted once.
  const lines = [...doc.preamble];
  for (const item of doc.items) {
    lines.push(
      `## ${item.name}`,
      "```yaml",
      ...stringify(ItemMeta.parse(item.meta), { lineWidth: 0 }).trimEnd().split("\n"),
      "```",
    );
    let extraFence: string | undefined;
    for (const line of item.extra) {
      lines.push(line);
      if (extraFence) {
        if (fenceEnd(line, extraFence)) extraFence = undefined;
      } else extraFence = fenceStart(line)?.marker;
    }
    // Close incomplete examples without removing their text or swallowing generated sections.
    if (extraFence) lines.push(extraFence);
    lines.push("### Claims");
    for (const claim of item.claims) {
      lines.push(writeAnchor(`- ${claim.text}`, { claim: claim.id, evidence: claim.evidence }));
    }
    lines.push("### Limits", ...item.limits.map((limit) => `- ${limit}`), "### Variants");
    for (const variant of item.variants) {
      const label = variant.label === null ? "" : `${variant.label}: `;
      lines.push(writeAnchor(`- ${label}${variant.text}`, { variant: variant.id, evidence: [] }));
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
