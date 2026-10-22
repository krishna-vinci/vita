import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resume } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { renderMarkdown } from "../render/markdown.js";
import { commitPaths, ensureRepo, log, readText, writeTextAtomic } from "../workspace/index.js";
import { recordStatement, setProfile, setProjectLinks } from "./chat-edits.js";
import { parseOutline } from "./outline.js";
import { parseProjects } from "./projects.js";

let root: string;
const original =
  '# Inventory\r\n## Archive\r\n```yaml\r\nlinks: ["https://github.com/example/archive"] # keep comment\r\ncustom: yes\r\n```\r\nUnparsed prose.\r\n### Claims\r\n- Kept notes. <!-- c:archive-notes -->\r\n## Other\r\nKeep exactly.\r\n';
beforeEach(async () => {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  root = await mkdtemp(join(tmpdir(), "vita-statement-"));
  await ensureRepo(root);
  await writeTextAtomic(root, "projects.md", original);
  await writeTextAtomic(
    root,
    "outline.md",
    "## Experience\n### Workshop\nUnparsed text.\n- Kept records. <!-- c:workshop-notes -->\n",
  );
  await writeTextAtomic(root, "profile.yaml", "name: Example\nheadline: Original\nlocation: Pune\ncontact: []\n");
  await commitPaths(root, ["projects.md", "outline.md", "profile.yaml"], "Fixture", "system");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("records a normalised user quote, today's date, thread ref and a cited claim as user; refuses invented quotes", async () => {
  const conversation = {
    messages: ["I built Archive\n entirely myself."],
    threadId: "saved-thread",
    now: new Date("2026-10-21T12:00:00Z"),
  };
  const result = await recordStatement(
    root,
    { itemSlug: "archive", quote: "I built Archive entirely MYSELF.", claimText: "Built Archive entirely alone." },
    conversation,
  );
  const parsed = parseProjects(await readText(root, "projects.md"));
  expect(parsed.issues).toEqual([]);
  expect(parsed.doc.items[0]?.claims.find((claim) => claim.id === result.claimId)?.evidence).toEqual([
    result.evidence.id,
  ]);
  expect(parsed.doc.items[0]?.meta.evidence).toContainEqual({
    id: result.evidence.id,
    kind: "statement",
    text: "I built Archive entirely MYSELF.",
    at: "2026-10-21",
    ref: "chat:saved-thread",
  });
  expect((await log(root, 1))[0]).toMatchObject({
    author: "user",
    message: "Record your statement: Built Archive entirely alone.",
  });
  const before = await readText(root, "projects.md");
  await expect(
    recordStatement(
      root,
      { itemSlug: "archive", quote: "I saved 99% of hosting costs", claimText: "Saved 99% of hosting costs." },
      conversation,
    ),
  ).rejects.toThrow("own messages");
  // A one-word fragment of a real message is not a statement.
  await expect(
    recordStatement(
      root,
      { itemSlug: "archive", quote: "built", claimText: "Built the whole platform." },
      conversation,
    ),
  ).rejects.toThrow("fragment");
  expect(await readText(root, "projects.md")).toBe(before);
  expect(before).toContain("Unparsed prose.\r\n");
  expect(before).toContain("## Other\r\nKeep exactly.\r\n");
});

it("records outline statements and indexes their receipts without changing existing prose", async () => {
  const before = await readText(root, "outline.md");
  const result = await recordStatement(
    root,
    { itemSlug: "workshop", quote: "I handled 30 records.", claimText: "Handled 30 records." },
    { messages: ["I handled 30 records."], threadId: "outline-chat", now: new Date("2026-10-21") },
  );
  const outline = await readText(root, "outline.md");
  expect(outline.startsWith(before)).toBe(true);
  const index = buildClaimIndex(parseProjects(await readText(root, "projects.md")).doc, parseOutline(outline));
  expect(index.claims.get(result.claimId)?.evidence).toEqual([result.evidence]);
});

it("adds/removes project links surgically, validates URLs, renders Website/GitHub and edits profile defaults", async () => {
  await setProjectLinks(root, { itemSlug: "archive", add: ["https://archive.example"] });
  const added = await readText(root, "projects.md");
  expect(added).toBe(
    original.replace(
      '["https://github.com/example/archive"]',
      '["https://github.com/example/archive","https://archive.example"]',
    ),
  );
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Example" },
    sections: [
      {
        id: "projects",
        title: "Projects",
        kind: "entries",
        items: [{ id: "archive", title: "Archive", source: "projects:archive" }],
      },
    ],
  });
  expect(renderMarkdown(resume, { projects: added })).toContain("[Website](<https://archive.example>)");
  expect(renderMarkdown(resume, { projects: added })).toContain("[GitHub](<https://github.com/example/archive>)");
  await setProjectLinks(root, { itemSlug: "archive", remove: ["https://archive.example"] });
  expect(await readText(root, "projects.md")).toBe(original);
  await expect(setProjectLinks(root, { itemSlug: "archive", add: ["javascript:alert(1)"] })).rejects.toThrow();
  await setProfile(root, { headline: "Editor" });
  expect(await readText(root, "profile.yaml")).toContain("headline: Editor");
  expect(await readText(root, "profile.yaml")).toContain("location: Pune");
});

it("refuses to record a request or a description of the person as a statement", async () => {
  const conversation = {
    messages: ["we forgot to highlight python/fastapi totally and also our data capabilities"],
    threadId: "t",
    now: new Date("2026-10-22T10:00:00Z"),
  };
  await expect(
    recordStatement(
      root,
      {
        itemSlug: "archive",
        quote: "we forgot to highlight python/fastapi",
        claimText: "The user identifies Python/FastAPI as strengths they want highlighted.",
      },
      conversation,
    ),
  ).rejects.toThrow("request to change the resume");
});

it("appends evidence without normalising mixed line endings outside the inserted block", async () => {
  const { appendEvidence } = await import("./chat-edits.js");
  const before = "# Inventory\n## Archive\r\n```yaml\r\nkind: project\n```\r\nUnparsed text.\n";
  const evidence = { id: "ev-info", kind: "statement" as const, text: "Built a useful archive.", at: "2026-10-22" };
  const after = appendEvidence(before, "archive", evidence);
  expect(after).toBe(
    before.replace(
      "```\r\nUnparsed",
      "evidence:\r\n  - id: ev-info\r\n    kind: statement\r\n    text: Built a useful archive.\r\n    at: 2026-10-22\r\n```\r\nUnparsed",
    ),
  );
  expect(parseProjects(after).issues).toEqual([]);
});

it("appends receipts to flow metadata and alternate fences while preserving existing evidence bytes", async () => {
  const { appendEvidence } = await import("./chat-edits.js");
  const evidence = { id: "ev-new", kind: "statement" as const, text: "Kept careful records." };
  for (const meta of [
    'evidence: [{id: ev-old, kind: doc, ref: "keep exactly"}] # comment',
    "{kind: project, evidence: []}",
    "{kind: project}",
    "evidence: [] # keep comment",
    "kind: project",
  ]) {
    const before = `## Archive\n~~~~yaml\n${meta}\n~~~~\nUnparsed prose.\r\n`;
    const after = appendEvidence(before, "archive", evidence);
    const parsed = parseProjects(after);
    expect(parsed.issues).toEqual([]);
    expect(parsed.doc.items[0]?.meta.evidence).toContainEqual(evidence);
    expect(after).toContain("Unparsed prose.\r\n");
    if (meta.includes("ev-old")) {
      expect(after).toContain('{id: ev-old, kind: doc, ref: "keep exactly"}');
      expect(parsed.doc.items[0]?.meta.evidence).toHaveLength(2);
    }
    if (meta.includes("# keep comment")) expect(after).toContain("# keep comment");
  }
});
