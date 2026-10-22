import { randomUUID } from "node:crypto";
import { type Evidence, HttpUrl, PutProfileRequest, slugify } from "@vita/shared";
import { isMap, isSeq, parse, parseDocument, stringify } from "yaml";
import { localDate } from "../pipeline/date.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { applySourceEdit } from "./edit.js";
import { fenceEnd, fenceStart, sourceLines } from "./markdown.js";
import { parseOutline } from "./outline.js";
import { parseProjects } from "./projects.js";
import { projectMetadataProposal } from "./relationship.js";

const profileEdits = new FileLocks();

/** Shared with the profile HTTP endpoint; callers hold the workspace exclusive lock. */
export async function writeProfile(root: string, value: unknown, baseHash: string) {
  const profile = PutProfileRequest.shape.profile.parse(value);
  const release = await profileEdits.acquire(resolveInWorkspace(root, "profile.yaml"), "writeProfile");
  try {
    if (((await fileHash(root, "profile.yaml")) ?? "") !== baseHash)
      throw new Error("Profile changed during this request");
    await writeTextAtomic(
      root,
      "profile.yaml",
      stringify(Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined && value !== ""))),
    );
    return { sha: await commitPaths(root, ["profile.yaml"], "Update profile", "user") };
  } finally {
    release();
  }
}

export async function setProfile(root: string, update: { headline?: string; location?: string; contact?: unknown }) {
  const hash = (await fileHash(root, "profile.yaml")) ?? "";
  const current = hash ? parse(await readText(root, "profile.yaml")) : {};
  return writeProfile(root, { ...current, ...update }, hash);
}

export async function setProjectLinks(root: string, input: { itemSlug: string; add?: string[]; remove?: string[] }) {
  for (const url of [...(input.add ?? []), ...(input.remove ?? [])]) HttpUrl.parse(url);
  const text = await readText(root, "projects.md");
  const hash = await fileHash(root, "projects.md");
  const item = parseProjects(text).doc.items.find((item) => item.slug === input.itemSlug);
  if (!item || !hash) throw new Error(`Project not found: ${input.itemSlug}`);
  const links = [...new Set([...item.meta.links.filter((url) => !input.remove?.includes(url)), ...(input.add ?? [])])];
  const proposal = projectMetadataProposal(text, hash, input.itemSlug, { links }, `Update links: ${item.name}`);
  return { ...(await applySourceEdit({ root, bundledDir: "" }, proposal, "user")), links };
}

function insertAtLine(text: string, line: number, addition: string) {
  const lines = sourceLines(text);
  const at = lines.slice(0, line - 1).reduce((n, line) => n + line.text.length + line.ending.length, 0);
  return text.slice(0, at) + (at && !text.slice(0, at).endsWith("\n") ? "\n" : "") + addition + text.slice(at);
}

/** Only actual user messages are supplied by the server, independently of model context. */
/**
 * Add one evidence entry to an item's YAML block in the same block style as the entries already
 * there. Only the inserted lines change; the rest of the file stays byte for byte.
 */
export function appendEvidence(text: string, itemSlug: string, evidence: Evidence): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const originalLines = sourceLines(text);
  const lines = originalLines.map((line) => line.text);
  const splice = (at: number, count: number, ...addition: string[]) => {
    const start = originalLines.slice(0, at).reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
    const end = originalLines
      .slice(0, at + count)
      .reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
    const prefix = text.slice(0, start);
    return (
      prefix +
      (prefix && !prefix.endsWith("\n") ? eol : "") +
      addition.map((line) => line + eol).join("") +
      text.slice(end)
    );
  };
  const items = parseProjects(text).doc.items;
  const position = items.findIndex((item) => item.slug === itemSlug);
  const start = items[position]?.line;
  if (start === undefined) throw new Error(`Project not found: ${itemSlug}`);
  const end = (items[position + 1]?.line ?? lines.length + 1) - 1;
  let marker: string | undefined;
  let open = -1;
  let close = -1;
  for (let index = start; index < end; index++) {
    const line = lines[index] ?? "";
    if (marker) {
      if (fenceEnd(line, marker)) {
        if (open >= 0) {
          close = index;
          break;
        }
        marker = undefined;
      }
    } else {
      const fence = fenceStart(line);
      if (fence) {
        marker = fence.marker;
        if (fence.info === "yaml") open = index;
      }
    }
  }
  const entry = stringify([evidence], { lineWidth: 0 })
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`);
  if (open < 0 || close < 0) {
    // No metadata block yet: add one after the heading.
    return splice(start, 0, "```yaml", "evidence:", ...entry, "```");
  }
  const yaml = originalLines
    .slice(open + 1, close)
    .map((line) => line.text + line.ending)
    .join("");
  const document = parseDocument(yaml);
  if (document.errors.length || !isMap(document.contents)) throw new Error("Project metadata must be a YAML mapping");
  const node = document.get("evidence", true);
  if (isSeq(node) && node.flow && node.range && (node.items.length || node.comment)) {
    const yamlOffset = originalLines
      .slice(0, open + 1)
      .reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
    const at = yamlOffset + node.range[1] - 1;
    return `${text.slice(0, at)}${node.items.length ? ", " : ""}${JSON.stringify(evidence)}${text.slice(at)}`;
  }
  if (document.contents.flow && document.contents.range) {
    const yamlOffset = originalLines
      .slice(0, open + 1)
      .reduce((sum, line) => sum + line.text.length + line.ending.length, 0);
    const at = yamlOffset + document.contents.range[1] - 1;
    if (isSeq(node) && node.range) {
      const position = yamlOffset + node.range[1] - 1;
      return text.slice(0, position) + JSON.stringify(evidence) + text.slice(position);
    }
    return (
      text.slice(0, at) +
      `${document.contents.items.length ? ", " : ""}evidence: [${JSON.stringify(evidence)}]` +
      text.slice(at)
    );
  }
  const key = lines.findIndex((line, index) => index > open && index < close && /^evidence:/.test(line));
  if (key < 0) {
    return splice(close, 0, "evidence:", ...entry);
  } else if (/^evidence:\s*\[\s*\]\s*$/.test(lines[key] ?? "")) {
    return splice(key, 1, "evidence:", ...entry);
  } else {
    let last = key;
    for (let index = key + 1; index < close; index++) {
      const line = lines[index] ?? "";
      if (line.trim() && !/^\s/.test(line)) break;
      if (line.trim()) last = index;
    }
    return splice(last + 1, 0, ...entry);
  }
}

// Requests ("highlight Python", "we forgot to add…") and descriptions of the person are not facts
// about their work; recording them as evidence pollutes the outline.
const REQUEST =
  /^(?:please\b|can you\b|could you\b|we forgot\b|i forgot\b|highlight\b|add\b|make\b|change\b|update\b|remove\b|mention\b|include\b|emphasi[sz]e\b)/i;
const META = /\b(?:the user|the person|wants? (?:it|them|this)? ?highlighted|wants? to highlight|would like)\b/i;

export async function recordStatement(
  root: string,
  input: { itemSlug: string; quote: string; claimText: string },
  conversation: { messages: string[]; threadId: string; now: Date },
) {
  const normalise = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
  const quote = normalise(input.quote);
  // A fragment such as "built" must not stand in for a statement; quote a real sentence part.
  if (quote.length < 12 || quote.split(" ").length < 3)
    throw new Error("Quote at least a few words the person actually said, not a fragment");
  if (!conversation.messages.some((text) => normalise(text).includes(quote)))
    throw new Error("Statement quote must appear in your own messages in this conversation");
  const claimText = input.claimText.replace(/\s+/gu, " ").trim();
  if (!claimText) throw new Error("Statement claim must not be empty");
  if (REQUEST.test(input.quote.trim()) || META.test(claimText))
    throw new Error(
      "That is a request to change the resume, not a fact about your work. Make the edit instead (a source proposal or resume operation); record statements only for facts the person states about what they did.",
    );
  const id = `statement-${randomUUID()}`;
  const evidence: Evidence = {
    id: `ev-${randomUUID()}`,
    kind: "statement",
    text: input.quote,
    at: localDate(conversation.now),
    ref: `chat:${conversation.threadId}`,
  };
  const projects = await readText(root, "projects.md");
  const parsed = parseProjects(projects);
  const item = parsed.doc.items.find((item) => item.slug === input.itemSlug);
  const summary = `Record your statement: ${claimText}`;
  let file: "outline" | "projects";
  let before: string;
  let after: string;
  let hash: string | null;
  if (item) {
    file = "projects";
    before = projects;
    hash = await fileHash(root, "projects.md");
    if (!hash) throw new Error("Projects file is missing");
    after = appendEvidence(before, input.itemSlug, evidence);
    const updated = parseProjects(after).doc.items;
    const position = updated.findIndex((entry) => entry.slug === input.itemSlug);
    const start = updated[position]?.line ?? 1;
    const end = updated[position + 1]?.line ?? sourceLines(after).length + 1;
    const claimHeading = sourceLines(after).findIndex(
      (line, index) => index + 1 > start && index + 1 < end && /^### Claims\s*$/.test(line.text),
    );
    after = insertAtLine(
      after,
      claimHeading < 0 ? end : claimHeading + 2,
      `${claimHeading < 0 ? "### Claims\n" : ""}- ${claimText} <!-- c:${id} ev:${evidence.id} -->\n`,
    );
  } else {
    file = "outline";
    before = await readText(root, "outline.md");
    hash = await fileHash(root, "outline.md");
    const outline = parseOutline(before);
    const entries = outline.sections.flatMap((section) => [section, ...section.entries]);
    const matches = entries.filter((entry) => slugify(entry.title) === input.itemSlug);
    if (matches.length !== 1) throw new Error(`Outline item not found or ambiguous: ${input.itemSlug}`);
    const target = matches[0];
    if (!target) throw new Error("Outline item missing");
    const next =
      entries.filter((entry) => entry.line > target.line).sort((a, b) => a.line - b.line)[0]?.line ??
      sourceLines(before).length + 1;
    const receipt = stringify({ statement_claims: [{ id, evidence: [evidence] }] }, { lineWidth: 0 });
    after = insertAtLine(
      before,
      next,
      `- ${claimText} <!-- c:${id} ev:${evidence.id} -->\n\`\`\`yaml\n${receipt}\`\`\`\n`,
    );
  }
  if (!hash) throw new Error("Source file is missing");
  const result = await applySourceEdit(
    { root, bundledDir: "" },
    { file, before, after, baseHash: hash, summary },
    "user",
  );
  return { claimId: id, evidence, ...result };
}
