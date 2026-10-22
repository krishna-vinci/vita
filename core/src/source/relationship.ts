import { PutRelationshipRequest, type SourceProposal } from "@vita/shared";
import { isMap, isNode, isSeq, parseDocument, stringify } from "yaml";
import { fenceEnd, fenceStart, sourceLines } from "./markdown.js";
import { parseProjects } from "./projects.js";

/** Change only the requested YAML values, retaining all surrounding user bytes. */
export function relationshipProposal(
  markdown: string,
  baseHash: string,
  slug: string,
  input: PutRelationshipRequest,
): SourceProposal {
  const name = parseProjects(markdown).doc.items.find((item) => item.slug === slug)?.name ?? slug;
  return projectMetadataProposal(
    markdown,
    baseHash,
    slug,
    PutRelationshipRequest.parse(input),
    `Set relationship: ${name}`,
  );
}

/** Shared surgical metadata writer for explicit chat metadata and statement receipts. */
export function projectMetadataProposal(
  markdown: string,
  baseHash: string,
  slug: string,
  input: Record<string, unknown>,
  summary: string,
): SourceProposal {
  const { doc, issues } = parseProjects(markdown);
  const matches = doc.items.filter((item) => item.slug === slug);
  if (matches.length !== 1)
    throw new Error(matches.length ? "Project slug is ambiguous" : `Project not found: ${slug}`);
  const item = matches[0];
  if (!item) throw new Error(`Project not found: ${slug}`);
  const next = doc.items[doc.items.indexOf(item) + 1]?.line ?? Infinity;
  if (issues.some((issue) => issue.line >= item.line && issue.line < next))
    throw new Error("Project metadata is invalid; repair it before setting relationship");
  const lines = sourceLines(markdown);
  const start = lines.slice(0, item.line - 1).reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
  const end = lines.slice(0, next - 1).reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
  const section = markdown.slice(start, end);
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  let marker: string | undefined;
  let yamlStart: number | undefined;
  let yamlEnd: number | undefined;
  let offset = 0;
  for (const line of sourceLines(section)) {
    if (marker) {
      if (fenceEnd(line.text, marker)) {
        if (yamlStart !== undefined) {
          yamlEnd = offset;
          break;
        }
        marker = undefined;
      }
    } else {
      const fence = fenceStart(line.text);
      if (fence) {
        marker = fence.marker;
        if (fence.info === "yaml") yamlStart = offset + line.text.length + line.ending.length;
      }
    }
    offset += line.text.length + line.ending.length;
  }
  // Lists stay in block style ("- item" lines) and scalars stay plain, like hand-written metadata.
  const scalar = (value: unknown) => stringify(value, { lineWidth: 0 }).trimEnd();
  const blockList = (values: unknown[], indent: string) =>
    values.map((value, index) => `${index ? indent : ""}- ${scalar(value)}`).join(eol);
  const entry = (key: string, value: unknown) =>
    Array.isArray(value)
      ? value.length
        ? `${key}:${eol}  ${blockList(value, "  ")}`
        : `${key}: []`
      : `${key}: ${scalar(value)}`;
  let updated: string;
  if (yamlStart === undefined) {
    const first = sourceLines(section)[0];
    const at = (first?.text.length ?? 0) + (first?.ending.length ?? 0);
    const yaml = Object.entries(input)
      .map(([key, value]) => `${entry(key, value)}${eol}`)
      .join("");
    updated = `${section.slice(0, at)}${first?.ending ? "" : eol}\`\`\`yaml${eol}${yaml}\`\`\`${eol}${section.slice(at)}`;
  } else {
    if (yamlEnd === undefined) throw new Error("Project metadata fence is unclosed");
    const yaml = section.slice(yamlStart, yamlEnd);
    const document = parseDocument(yaml);
    if (document.errors.length || !isMap(document.contents)) throw new Error("Project metadata must be a YAML mapping");
    const changes: { start: number; end: number; text: string }[] = [];
    const additions: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const node = document.get(key, true);
      if (isNode(node) && node.range) {
        const ending = /\r?\n$/.exec(yaml.slice(node.range[0], node.range[1]))?.[0] ?? "";
        const lineStart = yaml.lastIndexOf("\n", node.range[0] - 1) + 1;
        const indent = /^\s*/.exec(yaml.slice(lineStart, node.range[0]))?.[0] ?? "";
        const block = Array.isArray(value) && value.length > 0 && isSeq(node) && !node.flow;
        changes.push({
          start: node.range[0],
          end: node.range[1],
          text: (block ? blockList(value, indent) : JSON.stringify(value)) + ending,
        });
      } else additions.push(document.contents.flow ? `${key}: ${JSON.stringify(value)}` : entry(key, value));
    }
    if (additions.length) {
      const flow = document.contents.flow;
      const at = flow && document.contents.range ? document.contents.range[1] - 1 : yaml.length;
      changes.push({
        start: at,
        end: at,
        text: flow
          ? `${document.contents.items.length ? ", " : ""}${additions.join(", ")}`
          : `${yaml.endsWith("\n") ? "" : eol}${additions.join(eol)}${eol}`,
      });
    }
    let edited = yaml;
    for (const change of changes.sort((a, b) => b.start - a.start))
      edited = edited.slice(0, change.start) + change.text + edited.slice(change.end);
    updated = section.slice(0, yamlStart) + edited + section.slice(yamlEnd);
  }
  return {
    file: "projects",
    before: markdown,
    after: markdown.slice(0, start) + updated + markdown.slice(end),
    baseHash,
    summary,
  };
}
