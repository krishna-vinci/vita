import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume, Review } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseProjects } from "../source/index.js";
import { commitPaths, fileHash, log, readText, writeTextAtomic } from "../workspace/index.js";
import { nodes } from "./context.js";
import { applySuggestions, pendingSyncSuggestions, promoteBullet, suggestDownstream } from "./index.js";
import { changeSource, projects, required, sampleResume, setup } from "./test-fixtures.js";

let root: string;
let sinceSha: string;
const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const ws = () => ({ root, bundledDir });
beforeEach(async () => {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  root = await mkdtemp(join(tmpdir(), "vita-sync-"));
  sinceSha = await setup(root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
async function resume(id = "master") {
  return Resume.parse(JSON.parse(await readText(root, `resumes/${id}/resume.json`)));
}

it("diffs claims deterministically across master and bases, marks locks, and adds only to master", async () => {
  await changeSource(root);
  const before = await fileHash(root, "resumes/master/resume.json");
  const result = await suggestDownstream(ws(), sinceSha);
  expect(result).toEqual(await suggestDownstream(ws(), sinceSha));
  expect(result).toHaveLength(8);
  for (const id of ["master", "direction"]) {
    expect(result).toContainEqual(
      expect.objectContaining({
        resumeId: id,
        kind: "update",
        bulletId: "a",
        claimId: "outline-a",
        after: "Revised the outline.",
        locked: false,
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ resumeId: id, kind: "update", bulletId: "b", claimId: "project-b", locked: true }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ resumeId: id, kind: "remove", bulletId: "c", claimId: "project-c" }),
    );
  }
  expect(result.filter((r) => r.kind === "add").map((r) => r.resumeId)).toEqual(["master", "master"]);
  expect(await fileHash(root, "resumes/master/resume.json")).toBe(before);
});

it("applies one AI batch, protects actual locks, creates missing containers, and retains pending suggestions", async () => {
  await writeTextAtomic(root, "resumes/master/meta.yaml", "# Keep metadata\ncustom: retained\n");
  await commitPaths(root, ["resumes/master/meta.yaml"], "Metadata", "system");
  const sourceSha = await changeSource(root);
  const picks = (await suggestDownstream(ws(), sinceSha)).filter((r) => r.resumeId === "master");
  const count = (await log(root, 20)).length;
  const result = await applySuggestions(
    ws(),
    picks.map((r) => ({ ...r, locked: false })),
  );
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(await log(root, 20)).toHaveLength(count + 1);
  expect((await log(root, 1))[0]?.author).toBe("writer");
  const current = await resume();
  expect(nodes(current).find((n) => n.bullet.id === "a")?.bullet).toMatchObject({
    text: "Revised the outline.",
    origin: "ai",
    locked: false,
  });
  expect(nodes(current).find((n) => n.bullet.id === "b")?.bullet.text).toBe("Prepared the inventory.");
  expect(nodes(current).find((n) => n.bullet.id === "c")?.bullet.hidden).toBe(true);
  expect(nodes(current).find((n) => n.bullet.claims.includes("new-item-e"))?.item).toMatchObject({
    title: "New Item",
    source: "new-item",
  });
  const pending = (await pendingSyncSuggestions(ws())).filter((r) => r.resumeId === "master");
  expect(pending).toEqual([expect.objectContaining({ bulletId: "b", locked: true })]);
  const meta = await readText(root, "resumes/master/meta.yaml");
  expect(meta).toContain("# Keep metadata");
  expect(parseYaml(meta)).toMatchObject({
    custom: "retained",
    syncedAt: sourceSha,
    pendingSync: [expect.objectContaining({ bulletId: "b", locked: true })],
  });
  expect(await applySuggestions(ws(), pending)).toEqual({ sha: null });
});

it("keeps unselected changes pending while advancing the source checkpoint", async () => {
  const original = await resume();
  required(nodes(original).find((n) => n.bullet.id === "b")).bullet.locked = false;
  await writeTextAtomic(root, "resumes/master/resume.json", `${JSON.stringify(original, null, 2)}\n`);
  await commitPaths(root, ["resumes/master/resume.json"], "Unlock", "user");
  const sourceSha = await changeSource(root);
  const picks = (await pendingSyncSuggestions(ws())).filter((r) => r.resumeId === "master");
  await applySuggestions(ws(), [required(picks[0])]);
  expect(parseYaml(await readText(root, "resumes/master/meta.yaml")).syncedAt).toBe(sourceSha);
  const pending = (await pendingSyncSuggestions(ws())).filter((r) => r.resumeId === "master");
  expect(pending).toHaveLength(picks.length - 1);
  const checkpoint = required((await log(root, 1))[0]).sha;
  await applySuggestions(ws(), pending);
  expect(parseYaml(await readText(root, "resumes/master/meta.yaml")).syncedAt).toBe(checkpoint);
  expect((await pendingSyncSuggestions(ws())).filter((r) => r.resumeId === "master")).toEqual([]);
});

it("rejects stale or fabricated suggestions before writing any resume", async () => {
  await changeSource(root);
  const picks = await suggestDownstream(ws(), sinceSha);
  const edit = required(picks.find((r) => r.kind === "update" && !r.locked));
  const add = required(picks.find((r) => r.kind === "add"));
  const hash = await fileHash(root, "resumes/master/resume.json");
  await expect(applySuggestions(ws(), [add, { ...edit, after: "Invented result 999." }])).rejects.toMatchObject({
    code: "stale-suggestion",
  });
  await expect(applySuggestions(ws(), [{ ...edit, before: "Stale" }])).rejects.toMatchObject({
    code: "stale-suggestion",
  });
  expect(await fileHash(root, "resumes/master/resume.json")).toBe(hash);
});

it("promotes to an exact claim-set parent match as a locked user edit and invalidates review", async () => {
  const parent = await resume();
  required(nodes(parent)[0]).bullet.locked = true;
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(parent));
  const child = sampleResume("direction");
  required(nodes(child)[0]).bullet.text = "My clearer outline phrasing.";
  await writeTextAtomic(root, "resumes/direction/resume.json", JSON.stringify(child));
  const review = Review.parse({
    round: 1,
    lint: [],
    checks: [{ bulletId: "a", verdict: "supported", reason: "Supported" }],
    ats: [],
    render: null,
    gaps: [],
    overrides: [],
    done: true,
    blocking: [],
  });
  await writeTextAtomic(root, "resumes/master/review.json", JSON.stringify(review));
  const result = await promoteBullet(ws(), {
    from: { scope: "resume", id: "direction", bulletId: "a" },
    to: { kind: "parent" },
  });
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(required(nodes(await resume())[0]).bullet).toMatchObject({
    id: "a",
    text: "My clearer outline phrasing.",
    claims: ["outline-a"],
    origin: "user",
    locked: true,
  });
  expect((await log(root, 1))[0]?.author).toBe("user");
  expect(Review.parse(JSON.parse(await readText(root, "resumes/master/review.json")))).toMatchObject({
    done: false,
    checks: [],
    blocking: ["Resume changed; checking and rendering required."],
  });
});

it("adds an application's multi-claim bullet to its base without dropping claims or changing the source", async () => {
  const child = sampleResume("job-example");
  child.kind = "job";
  child.parent = "direction";
  required(nodes(child)[0]).bullet.claims = ["outline-a", "project-b"];
  required(nodes(child)[0]).bullet.text = "Combined and polished wording.";
  const childSection = required(child.sections[0]);
  childSection.id = "new-section";
  childSection.title = "New section";
  const childItem = required(childSection.items[0]);
  childItem.id = "new-item";
  childItem.title = "New item";
  childItem.source = "new-item";
  const raw = JSON.stringify(child);
  await writeTextAtomic(root, "applications/job-example/resume.json", raw);
  const result = await promoteBullet(ws(), {
    from: { scope: "application", id: "job-example", bulletId: "a" },
    to: { kind: "parent" },
  });
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(nodes(await resume("direction")).at(-1)?.bullet).toMatchObject({
    text: "Combined and polished wording.",
    claims: ["outline-a", "project-b"],
    origin: "user",
    locked: true,
  });
  expect((await resume("direction")).sections.at(-1)?.title).toBe("New section");
  expect(await readText(root, "applications/job-example/resume.json")).toBe(raw);
});

it("appends uniquely anchored variants while preserving original comments, prose, and other items", async () => {
  const input = {
    from: { scope: "resume" as const, id: "direction", bulletId: "a" },
    to: { kind: "variant" as const, itemSlug: "example-item", label: "Concise" },
  };
  await promoteBullet(ws(), input);
  await promoteBullet(ws(), input);
  const text = await readText(root, "projects.md");
  const variants = required(parseProjects(text).doc.items[0]).variants;
  expect(variants).toEqual([
    { id: "example-item-promoted", label: "Concise", text: "Prepared the outline." },
    { id: "example-item-promoted-2", label: "Concise", text: "Prepared the outline." },
  ]);
  expect(text.replace(/- Concise:.*<!-- v:example-item-promoted(?:-2)? -->\n/g, "")).toBe(projects);
  expect((await log(root, 1))[0]?.author).toBe("user");
});

it("rejects invalid parent/variant targets and symlink escapes", async () => {
  await expect(
    promoteBullet(ws(), { from: { scope: "resume", id: "master", bulletId: "a" }, to: { kind: "parent" } }),
  ).rejects.toMatchObject({ code: "no-parent" });
  await expect(
    promoteBullet(ws(), {
      from: { scope: "resume", id: "direction", bulletId: "a" },
      to: { kind: "variant", itemSlug: "missing" },
    }),
  ).rejects.toMatchObject({ code: "unknown-item" });
  await rm(join(root, "resumes/master/resume.json"));
  await symlink(join(root, "../outside.json"), join(root, "resumes/master/resume.json"));
  await expect(suggestDownstream(ws(), sinceSha)).rejects.toThrow("Cannot resolve path");
});

it("retains source changes even when a resume was edited before its first sync", async () => {
  await changeSource(root);
  const current = await resume();
  required(nodes(current)[0]).bullet.text = "A later user phrasing.";
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(current));
  await commitPaths(root, ["resumes/master/resume.json"], "Apply resume edits", "user");
  expect((await pendingSyncSuggestions(ws())).filter((s) => s.resumeId === "master")).toHaveLength(5);
});

it("handles multi-claim updates as one combined edit without dropping citations", async () => {
  const current = await resume();
  const bullet = required(nodes(current)[0]).bullet;
  bullet.claims = ["outline-a", "project-b"];
  bullet.text = "Original combined wording.";
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(current));
  await commitPaths(root, ["resumes/master/resume.json"], "Combine claims", "user");
  await changeSource(root);
  const picks = (await suggestDownstream(ws(), sinceSha)).filter((s) => s.resumeId === "master" && s.bulletId === "a");
  expect(picks).toHaveLength(2);
  expect(picks.map((s) => s.after)).toEqual([
    "Revised the outline. Revised the inventory.",
    "Revised the outline. Revised the inventory.",
  ]);
  await applySuggestions(ws(), picks);
  expect(required(nodes(await resume())[0]).bullet).toMatchObject({
    text: picks[0]?.after,
    claims: ["outline-a", "project-b"],
  });
});

it("appends a missing Variants subsection using existing CRLF endings and leaves the following item intact", async () => {
  const original =
    projects.replace("### Variants\n\n", "").replaceAll("\n", "\r\n") +
    "\r\n## Other Item\r\n```yaml\r\nkind: project\r\n```\r\n### Claims\r\n- Other fact. <!-- c:other-fact -->\r\n";
  await writeTextAtomic(root, "projects.md", original);
  await promoteBullet(ws(), {
    from: { scope: "resume", id: "direction", bulletId: "a" },
    to: { kind: "variant", itemSlug: "example-item" },
  });
  const text = await readText(root, "projects.md");
  expect(
    text.replace("### Variants\r\n- Promoted: Prepared the outline. <!-- v:example-item-promoted -->\r\n", ""),
  ).toBe(original);
  expect(parseProjects(text).doc.items.map((i) => i.variants.length)).toEqual([1, 0]);
});

it("tracks later source edits and removals of claims accepted during a partial sync", async () => {
  await changeSource(root);
  const picks = (await pendingSyncSuggestions(ws())).filter((s) => s.resumeId === "master");
  await applySuggestions(
    ws(),
    picks.filter((s) => s.bulletId === "a" || s.claimId === "new-item-e"),
  );
  const outline = await readText(root, "outline.md");
  await writeTextAtomic(root, "outline.md", outline.replace("Revised the outline.", "Prepared the outline."));
  const inventory = await readText(root, "projects.md");
  await writeTextAtomic(root, "projects.md", inventory.replace("- Checked the new item. <!-- c:new-item-e -->\n", ""));
  await commitPaths(root, ["outline.md", "projects.md"], "Revert and remove accepted claims", "user");
  const pending = (await pendingSyncSuggestions(ws())).filter((s) => s.resumeId === "master");
  expect(pending).toContainEqual(
    expect.objectContaining({ kind: "update", bulletId: "a", after: "Prepared the outline." }),
  );
  expect(pending).toContainEqual(expect.objectContaining({ kind: "remove", claimId: "new-item-e" }));
  expect(pending).toContainEqual(expect.objectContaining({ kind: "add", claimId: "project-d" }));
});

it("reserves outline claim ids when creating a new variant anchor", async () => {
  const text = await readText(root, "outline.md");
  await writeTextAtomic(root, "outline.md", `${text}- Reserved source fact. <!-- c:example-item-promoted -->\n`);
  await promoteBullet(ws(), {
    from: { scope: "resume", id: "direction", bulletId: "a" },
    to: { kind: "variant", itemSlug: "example-item" },
  });
  expect(await readText(root, "projects.md")).toContain("<!-- v:example-item-promoted-2 -->");
});
