import { randomUUID } from "node:crypto";
import { type Evidence, HttpUrl, PutProfileRequest, slugify } from "@vita/shared";
import { parse, stringify } from "yaml";
import { localDate } from "../pipeline/date.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { applySourceEdit } from "./edit.js";
import { sourceLines } from "./markdown.js";
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
    after = projectMetadataProposal(
      before,
      hash,
      input.itemSlug,
      { evidence: [...item.meta.evidence, evidence] },
      summary,
    ).after;
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
