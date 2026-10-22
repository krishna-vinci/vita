import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InfoView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { loadContext } from "../pipeline/context.js";
import { commitPaths, ensureRepo, log, readText, writeTextAtomic } from "../workspace/index.js";
import { parseInfo, readInfo, writeInfo } from "./info.js";
import { parseOutline } from "./outline.js";
import { parseProjects } from "./projects.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const owner = "/home/krishna/vita-data";
let root: string;
const outline =
  "# Example\r\n## Professional Summary\r\nOriginal summary. <!-- c:original-summary -->\r\n\r\n## Experience Source\r\n\r\n**Independent Developer** | *Remote* | *2020 – Present*\r\n\r\n- Built an archive. <!-- c:archive-built ev:ev-built -->\r\nUnmodelled prose stays.\r\n\r\n## Education & Certifications\r\n\r\n**Bachelor of Arts** — Example University\r\n\r\n**Example Certificate** — Pursuing\r\n\r\n## Interests\r\nKeep this exactly.\r\n";
const projects =
  "# Inventory\r\n## Archive\r\n```yaml\r\nkind: project # keep\r\nperiod: 2025 # dates\r\npurpose: Old purpose\r\nlinks:\r\n  - https://archive.example\r\nstack:\r\n  - SQLite\r\ncustom: { untouched: yes }\r\n```\r\nUnparsed project prose.\r\n### Claims\r\n- Built an archive. <!-- c:archive-built ev:ev-built -->\r\n### Limits\r\n- No invented counts.\r\n### Variants\r\n- Short: Created an archive. <!-- v:archive-short -->\r\n\r\n## Other\r\n```yaml\r\nkind: publication\r\n```\r\nKeep other bytes.\r\n";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-info-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await ensureRepo(root);
  await writeTextAtomic(root, "outline.md", outline);
  await writeTextAtomic(root, "projects.md", projects.replace("period: 2025", 'period: "2025"'));
  await writeTextAtomic(root, "profile.yaml", "name: Example\ncontact: []\n");
  await commitPaths(root, ["."], "Fixture", "system");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const ws = () => ({ root, bundledDir });
const save = async (
  collection: "roles" | "projects" | "education" | "certifications",
  action: "create" | "update" | "delete",
  input: Record<string, unknown>,
  id?: string,
) => {
  const view = await readInfo(root);
  return writeInfo(
    ws(),
    {
      collection,
      action,
      id,
      input: { baseHash: view.hash[collection === "projects" ? "projects" : "outline"], ...input },
    },
    new Date("2026-10-22T12:00:00Z"),
  );
};

it.each(["developer", "nurse", "teacher", "accountant"])(
  "parses %s fixture styles, inventory role items and unrecognised outline sections",
  async (fixture) => {
    await cp(join(bundledDir, "fixtures", fixture), root, { recursive: true });
    const view = InfoView.parse(await readInfo(root));
    expect(view.roles).toHaveLength(1);
    expect(view.roles[0]?.organisation).toBeTruthy();
    expect(view.roles[0]?.period).toMatch(/20\d{2}/);
    expect(view.roles[0]?.highlights).toHaveLength(3);
    expect(view.projects).toHaveLength(2);
    expect(view.other.some((entry) => entry.section === "Skills")).toBe(true);
    const role = view.roles[0];
    const before = await readText(root, "outline.md");
    await save("roles", "update", { title: "Updated title" }, role?.id);
    expect(await readText(root, "outline.md")).toBe(before.replace(role?.title ?? "", "Updated title"));
  },
);

it.skipIf(!existsSync(join(owner, "outline.md")) || !existsSync(join(owner, "projects.md")))(
  "parses temporary copies of the owner's source and preserves unrelated bytes on edits",
  async () => {
    await cp(join(owner, "outline.md"), join(root, "outline.md"));
    await cp(join(owner, "projects.md"), join(root, "projects.md"));
    const view = InfoView.parse(await readInfo(root));
    expect(view.roles.some((role) => role.title === "Independent Developer")).toBe(true);
    expect(view.education.some((entry) => entry.degree === "Bachelor of Arts")).toBe(true);
    expect(view.certifications.some((entry) => entry.status === "Pursuing")).toBe(true);
    expect(view.projects.length).toBeGreaterThan(0);
    const before = await readText(root, "outline.md");
    const role = view.roles.find((role) => role.title === "Independent Developer");
    await save("roles", "update", { location: "Elsewhere" }, role?.id);
    expect(await readText(root, "outline.md")).toBe(before.replace("| *Remote* |", "| *Elsewhere* |"));
    const project = view.projects[0];
    const projectBefore = await readText(root, "projects.md");
    await save("projects", "update", { purpose: "A temporary test purpose" }, project?.id);
    expect(parseProjects(await readText(root, "projects.md")).issues).toEqual([]);
    expect(await readText(root, "projects.md")).toContain("purpose: A temporary test purpose");
    expect(projectBefore.length).toBeGreaterThan(0);
  },
);

it("round trips summary, role, education, certification and project fields with exact byte diffs", async () => {
  let view = await readInfo(root);
  expect(view.education[0]).toMatchObject({ degree: "Bachelor of Arts", institution: "Example University" });
  expect(view.certifications[0]).toMatchObject({ name: "Example Certificate", status: "Pursuing" });
  await save("roles", "update", { location: "On site" }, view.roles[0]?.id);
  let expected = outline.replace("*Remote*", "*On site*");
  expect(await readText(root, "outline.md")).toBe(expected);
  view = await readInfo(root);
  await save("education", "update", { institution: "New University" }, view.education[0]?.id);
  expected = expected.replace("Example University", "New University");
  expect(await readText(root, "outline.md")).toBe(expected);
  await save("certifications", "update", { status: "2026" }, view.certifications[0]?.id);
  expected = expected.replace("Pursuing", "2026");
  expect(await readText(root, "outline.md")).toBe(expected);
  view = await readInfo(root);
  await writeInfo(ws(), { collection: "summary", input: { baseHash: view.hash.outline, text: "New summary." } });
  expected = expected.replace("Original summary.", "New summary.");
  expect(await readText(root, "outline.md")).toBe(expected);
  const before = await readText(root, "projects.md");
  await save("projects", "update", { purpose: "For local volunteers" }, "archive");
  expect(await readText(root, "projects.md")).toBe(before.replace("Old purpose", '"For local volunteers"'));
  const current = await readText(root, "projects.md");
  await save("projects", "update", { links: ["https://new.example"], stack: ["SQLite", "TypeScript"] }, "archive");
  expect(await readText(root, "projects.md")).toBe(
    current
      .replace("- https://archive.example", "- https://new.example")
      .replace("- SQLite", "- SQLite\r\n  - TypeScript"),
  );
});

it("edits anchors in place, dates new balanced statements, deletes just one bullet and loads the pipeline context", async () => {
  const view = await readInfo(root);
  const role = view.roles[0] as NonNullable<(typeof view.roles)[0]>;
  await save("roles", "update", { highlights: [{ ...role.highlights[0], text: "Maintained an archive." }] }, role.id);
  expect(await readText(root, "outline.md")).toBe(outline.replace("- Built an archive.", "- Maintained an archive."));
  const added = await save(
    "roles",
    "update",
    {
      highlights: [
        { ...role.highlights[0], text: "Maintained an archive." },
        { text: "Handled 30 records each week." },
      ],
    },
    role.id,
  );
  const newRole = added.view.roles[0];
  const claim = newRole?.highlights[1];
  expect(claim?.id).toMatch(/^statement-/);
  const context = await loadContext(ws());
  try {
    expect(context.index.claims.get(claim?.id ?? "")?.evidence).toEqual([
      expect.objectContaining({ kind: "statement", text: "Handled 30 records each week.", at: "2026-10-22" }),
    ]);
  } finally {
    context.search.close();
  }
  const beforeDelete = await readText(root, "outline.md");
  await save("roles", "update", { highlights: [newRole?.highlights[0]] }, newRole?.id);
  const deletedLine = sourceBullet(beforeDelete, claim?.id ?? "");
  expect(await readText(root, "outline.md")).toBe(beforeDelete.replace(deletedLine, ""));
  const p = (await readInfo(root)).projects[0];
  await save(
    "projects",
    "update",
    {
      highlights: [
        { ...p?.highlights[0], text: "Maintained the archive." },
        { text: "Served 20 volunteers each week." },
      ],
    },
    p?.id,
  );
  const updated = await readInfo(root);
  const projectClaim = updated.projects[0]?.highlights[1];
  const index = buildClaimIndex(
    parseProjects(await readText(root, "projects.md")).doc,
    parseOutline(await readText(root, "outline.md")),
  );
  expect(index.claims.get(projectClaim?.id ?? "")?.evidence).toEqual([
    expect.objectContaining({ kind: "statement", text: "Served 20 volunteers each week.", at: "2026-10-22" }),
  ]);
  expect((await log(root, 1))[0]).toMatchObject({ author: "user", message: "Update project" });
});
function sourceBullet(markdown: string, id: string) {
  return markdown.split(/(?<=\n)/).find((line) => line.startsWith("- ") && line.includes(`c:${id}`)) ?? "missing";
}

it.each(["balanced", "trust", "strict"])(
  "creates, updates and deletes each entry type in %s mode without losing unmodelled text",
  async (honesty) => {
    await writeTextAtomic(root, "config/rules.yaml", `honesty: ${honesty}\n`);
    let result = await save("roles", "create", {
      title: "New role",
      organisation: "Organisation",
      location: "Remote",
      period: "2026",
      highlights: [{ text: "Maintained clear records for everyone." }],
    });
    const role = result.view.roles.find((role) => role.title === "New role");
    expect(role).toMatchObject({ organisation: "Organisation", location: "Remote", period: "2026" });
    expect(await readText(root, "outline.md")).toContain("**New role** | Organisation | *Remote* | *2026*");
    expect(await readText(root, "outline.md")).toContain(
      honesty === "strict" ? "<!-- c:statement-" : "kind: statement",
    );
    await save("roles", "update", { title: "Revised role" }, role?.id);
    result = await save("education", "create", {
      degree: "New degree",
      institution: "College",
      year: "2026",
      details: "Evening programme",
    });
    const education = result.view.education.find((entry) => entry.degree === "New degree");
    expect(education).toMatchObject({ institution: "College", year: "2026", details: "Evening programme" });
    result = await save("education", "update", { year: "2027" }, education?.id);
    expect(result.view.education.find((entry) => entry.degree === "New degree")?.year).toBe("2027");
    result = await save("projects", "create", {
      name: "New project",
      period: "2026",
      purpose: "For volunteers",
      links: ["https://new.example"],
      stack: ["SQLite"],
      highlights: [{ text: "Built a service for volunteers." }],
    });
    const project = result.view.projects.find((entry) => entry.name === "New project");
    expect(project).toMatchObject({ purpose: "For volunteers", period: "2026" });
    result = await save("projects", "update", { name: "Renamed project", period: "2027" }, project?.id);
    expect(result.view.projects.find((entry) => entry.name === "Renamed project")?.period).toBe("2027");
    result = await save("certifications", "create", { name: "New certification", status: "Pursuing" });
    const certification = result.view.certifications.find((entry) => entry.name === "New certification");
    expect(certification?.status).toBe("Pursuing");
    await save("certifications", "update", { status: "2026" }, certification?.id);
    for (const [collection, id] of [
      ["roles", (await readInfo(root)).roles.find((entry) => entry.title === "Revised role")?.id],
      ["education", education?.id],
      ["projects", "renamed-project"],
      ["certifications", (await readInfo(root)).certifications.find((entry) => entry.name === "New certification")?.id],
    ] as const)
      await save(collection, "delete", {}, id);
    const final = await readInfo(root);
    expect(final.roles).toHaveLength(1);
    expect(final.education).toHaveLength(1);
    expect(final.projects).toHaveLength(1);
    expect(final.certifications).toHaveLength(1);
    expect(await readText(root, "outline.md")).toContain("Unmodelled prose stays.\r\n");
    expect(await readText(root, "projects.md")).toContain("Keep other bytes.\r\n");
  },
);

it("rejects stale hashes, duplicate entries, foreign anchors and malformed metadata before writing", async () => {
  const view = await readInfo(root);
  await expect(writeInfo(ws(), { collection: "summary", input: { baseHash: "stale", text: "New" } })).rejects.toThrow(
    "changed elsewhere",
  );
  await expect(
    save("roles", "update", { highlights: [{ id: "foreign-claim", text: "Not mine" }] }, view.roles[0]?.id),
  ).rejects.toThrow("does not belong");
  expect(await readText(root, "outline.md")).toBe(outline);
  const before = await readText(root, "projects.md");
  await expect(save("projects", "create", { name: "Archive" })).rejects.toThrow("already exists");
  expect(await readText(root, "projects.md")).toBe(before);
  expect(parseInfo(outline, before).other).toContainEqual({ section: "Interests", title: "Interests" });
});

it("adds absent fields in the existing style, parses inline graduation years, and retains metadata fences in summaries", async () => {
  const original =
    "## Summary\nOld summary. <!-- c:summary-old -->\n\n```yaml\ncustom: keep\n```\n\n## Work\n### Engineer\n- Wrote clear notes. <!-- c:notes -->\n## Education\n**Degree** — College (2024)\n## Interests\nKeep exactly.\n";
  await writeTextAtomic(root, "outline.md", original);
  let view = await readInfo(root);
  expect(view.education[0]).toMatchObject({ degree: "Degree", institution: "College", year: "2024" });
  await save("education", "update", { year: "2025" }, view.education[0]?.id);
  expect(await readText(root, "outline.md")).toBe(original.replace("(2024)", "(2025)"));
  const role = (await readInfo(root)).roles[0];
  let saved = await save("roles", "update", { organisation: "Workshop", location: "Remote", period: "2026" }, role?.id);
  expect(saved.view.roles[0]).toMatchObject({
    title: "Engineer",
    organisation: "Workshop",
    location: "Remote",
    period: "2026",
  });
  saved = await save("roles", "create", {
    title: "Assistant",
    organisation: "Workshop",
    period: "2025",
    location: "Local",
  });
  expect(saved.view.roles.find((entry) => entry.title === "Assistant")).toMatchObject({
    organisation: "Workshop",
    period: "2025",
    location: "Local",
  });
  view = await readInfo(root);
  const before = await readText(root, "outline.md");
  await writeInfo(ws(), { collection: "summary", input: { baseHash: view.hash.outline, text: "Updated summary." } });
  expect(await readText(root, "outline.md")).toBe(before.replace("Old summary.", "Updated summary."));
});

it("supports creates after sources are cleared or absent, including repeated create/delete", async () => {
  await rm(join(root, "outline.md"));
  await rm(join(root, "projects.md"));
  let view = await readInfo(root);
  expect(view.hash.outline).toBe("");
  await writeInfo(ws(), { collection: "summary", input: { baseHash: view.hash.outline, text: "Starting fresh." } });
  for (let i = 0; i < 2; i++) {
    const saved = await save("projects", "create", {
      name: "Only project",
      highlights: [{ text: "Built a service for everyone." }],
    });
    expect(saved.view.projects).toHaveLength(1);
    await save("projects", "delete", {}, "only-project");
    expect(await readText(root, "projects.md")).toBe("");
  }
  await writeTextAtomic(root, "outline.md", "\n\n");
  const saved = await save("education", "create", { degree: "New degree", year: "2026" });
  expect(saved.view.education[0]).toMatchObject({ degree: "New degree", year: "2026" });
  view = await readInfo(root);
  await expect(writeInfo(ws(), { collection: "summary", input: { baseHash: "", text: "Stale" } })).rejects.toThrow(
    "changed elsewhere",
  );
  expect(view.hash.outline).toMatch(/^[a-f0-9]{64}$/);
});

it("creates roles with empty optional fields in the dominant pipe style and certifications without a status", async () => {
  let saved = await save("roles", "create", { title: "New role" });
  let role = saved.view.roles.find((entry) => entry.title === "New role");
  expect(role).toBeDefined();
  saved = await save("roles", "update", { organisation: "Workshop", location: "Remote", period: "2026" }, role?.id);
  role = saved.view.roles.find((entry) => entry.title === "New role");
  expect(role).toMatchObject({ organisation: "Workshop", location: "Remote", period: "2026" });
  expect(await readText(root, "outline.md")).toContain("**New role** | Workshop | *Remote* | *2026*");
  saved = await save("certifications", "create", { name: "New credential" });
  expect(saved.view.certifications.find((entry) => entry.name === "New credential")?.status).toBeUndefined();
  const certification = saved.view.certifications.find((entry) => entry.name === "Example Certificate");
  saved = await save("certifications", "update", { status: "" }, certification?.id);
  expect(saved.view.certifications.find((entry) => entry.name === "Example Certificate")?.status).toBe("");
});
