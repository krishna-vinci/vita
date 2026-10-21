import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume, visibleBullets } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGenerationRuntime } from "../agent/roles.js";
import { buildClaimIndex } from "../claims/index.js";
import { applyOps } from "../ops/index.js";
import * as render from "../render/index.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { projects, required, sampleResume } from "../sync/test-fixtures.js";
import { commitPaths, ensureRepo, readText, writeTextAtomic } from "../workspace/index.js";
import { generateBase } from "./base.js";
import { generateMaster } from "./master.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let resume: Resume;
const closes: (() => Promise<void>)[] = [];
const outline =
  "# Alex\n## Professional Summary\nPrepared clear records and shared reliable guidance.\n## Experience\n### Example Team\n- Prepared the outline. <!-- c:outline-a -->\n";
const ws = () => ({ root, bundledDir });
async function commit(day: number, paths: string[], message: string) {
  vi.stubEnv("GIT_COMMITTER_DATE", `2026-01-${String(day).padStart(2, "0")}T12:00:00Z`);
  return commitPaths(root, paths, message, "user");
}
async function save(day: number, message: string) {
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
  return commit(day, ["resumes/master/resume.json"], message);
}
async function userEdit(id: string, text: string, day = 2) {
  const template = await render.loadTemplate([join(bundledDir, "templates")], resume.template);
  resume = applyOps(resume, [{ op: "bullet.edit", id, text }], {
    by: "user",
    template: template.meta,
    index: buildClaimIndex(parseProjects(projects).doc, parseOutline(outline)),
    now: () => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  }).resume;
  await save(day, "Edit a resume line");
}
async function generate(draft: Resume, baseId?: string, checked = draft) {
  const faux = await createGenerationRuntime([
    { tool: "submit_resume", arguments: JSON.parse(JSON.stringify(draft)) },
    {
      tool: "submit_checks",
      arguments: {
        checks: visibleBullets(checked).map((bullet) => ({
          bulletId: bullet.id,
          verdict: "supported",
          reason: "Compared with source",
        })),
      },
    },
  ]);
  closes.push(faux.close);
  if (!faux.models) throw new Error("Missing faux models");
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("faux"), log: "" });
  vi.spyOn(render, "pdfText").mockResolvedValue({
    pages: 1,
    text: visibleBullets(checked)
      .map((bullet) => bullet.text)
      .join("\n"),
  });
  const deps = {
    runtime: faux.runtime,
    models: faux.models,
    retry: { enabled: false },
    now: () => new Date("2026-01-05T12:00:00Z"),
  };
  return baseId ? generateBase(ws(), { baseId }, deps) : generateMaster(ws(), deps);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-source-wins-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, ".vita/agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await ensureRepo(root);
  resume = sampleResume();
  resume.sections.unshift({
    id: "summary",
    kind: "summary",
    title: "Summary",
    items: [
      {
        id: "summary-item",
        title: "",
        bullets: [
          {
            id: "summary-bullet",
            text: "Prepared clear records and shared reliable guidance.",
            claims: ["outline.summary"],
            origin: "ai",
            locked: false,
          },
        ],
      },
    ],
  });
  await writeTextAtomic(root, "outline.md", outline);
  await writeTextAtomic(root, "projects.md", projects);
  await writeTextAtomic(root, "profile.yaml", "name: Alex\ncontact: []\n");
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
  await commit(1, ["."], "Generate master resume: master");
});
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("regenerates an older edited lock, marks a changed writer id, and retains a newer lock verbatim", async () => {
  await userEdit("a", "My earlier outline wording.");
  await writeTextAtomic(root, "outline.md", outline.replace("Prepared the outline.", "Revised the outline."));
  await writeTextAtomic(root, "projects.md", projects.replace("Prepared the inventory.", "Updated the inventory."));
  await commit(3, ["outline.md", "projects.md"], "Update sources");
  await userEdit("b", "My later inventory wording.", 4);
  const draft = structuredClone(resume);
  const changed = required(visibleBullets(draft).find((bullet) => bullet.id === "a"));
  changed.id = "rewritten-a";
  changed.text = "Revised the outline.";
  const result = await generate(draft);
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "rewritten-a")).toMatchObject({
    text: "Revised the outline.",
    origin: "ai",
    locked: false,
    updatedFromSource: { at: "2026-01-05T12:00:00.000Z", previousText: "My earlier outline wording." },
  });
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "b")).toEqual(
    visibleBullets(resume).find((bullet) => bullet.id === "b"),
  );
});

it("uses the last generation commit for legacy locks, even when source and generation share a second", async () => {
  const legacy = required(visibleBullets(resume).find((bullet) => bullet.id === "b"));
  expect(legacy.lockedAt).toBeUndefined();
  const unchanged = required(visibleBullets(resume).find((bullet) => bullet.id === "a"));
  unchanged.origin = "user";
  unchanged.locked = true;
  await save(1, "Generate master resume: master");
  await writeTextAtomic(root, "projects.md", projects.replace("Prepared the inventory.", "Revised the inventory."));
  await commit(1, ["projects.md"], "Newer source in the same second");
  const draft = structuredClone(resume);
  required(visibleBullets(draft).find((bullet) => bullet.id === "b")).text = "Revised the inventory.";
  const result = await generate(draft);
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "b")).toMatchObject({
    locked: false,
    origin: "ai",
    updatedFromSource: { previousText: "Prepared the inventory." },
  });
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "a")).toEqual(unchanged);
});

it("replaces an older local summary from the outline, then seeds an existing base from the current master", async () => {
  required(visibleBullets(resume).find((bullet) => bullet.id === "summary-bullet")).claims = ["outline-a"];
  await userEdit("summary-bullet", "My older local summary.");
  const base = { ...structuredClone(resume), id: "direction", kind: "base" as const, parent: "master" };
  await writeTextAtomic(root, "resumes/direction/resume.json", JSON.stringify(base));
  await writeTextAtomic(root, "resumes/direction/base.yaml", "name: Direction\ntemplate: rover-base\n");
  await commit(2, ["resumes/direction"], "Generate base resume: direction");
  const next = "Prepared reliable guidance and coordinated shared records.";
  await writeTextAtomic(
    root,
    "outline.md",
    outline.replace("Prepared clear records and shared reliable guidance.", next),
  );
  await commit(3, ["outline.md"], "Rewrite Professional Summary");
  const draft = structuredClone(resume);
  const summary = required(visibleBullets(draft).find((bullet) => bullet.id === "summary-bullet"));
  summary.text = next;
  summary.claims = ["outline.summary"];
  const master = await generate(draft);
  expect(master.review.done).toBe(true);
  expect(visibleBullets(master.resume)[0]).toMatchObject({
    text: next,
    claims: ["outline.summary"],
    updatedFromSource: { previousText: "My older local summary." },
  });
  const result = await generate(master.resume, "direction");
  expect(result.review.done).toBe(true);
  expect(visibleBullets(result.resume)[0]).toMatchObject({
    text: next,
    claims: ["outline.summary"],
    updatedFromSource: { previousText: "My older local summary." },
  });
  expect(
    Resume.parse(JSON.parse(await readText(root, "resumes/direction/resume.json"))).sections[0]?.items[0]?.bullets[0]
      ?.text,
  ).toBe(next);
});

it("keeps a local summary override when it was edited after the outline", async () => {
  await userEdit("summary-bullet", "My current local summary.", 4);
  const draft = structuredClone(resume);
  const result = await generate(draft);
  expect(visibleBullets(result.resume)[0]).toMatchObject({
    text: "My current local summary.",
    origin: "user",
    locked: true,
    claims: ["outline.summary"],
  });
  expect(visibleBullets(result.resume)[0]?.updatedFromSource).toBeUndefined();
});

it("keeps a parent's summary override local when creating a new base", async () => {
  await userEdit("summary-bullet", "My master-only summary.", 4);
  const draft = structuredClone(resume);
  required(visibleBullets(draft).find((bullet) => bullet.id === "summary-bullet")).text =
    "Prepared clear records and shared reliable guidance.";
  const faux = await createGenerationRuntime([
    { tool: "submit_resume", arguments: JSON.parse(JSON.stringify(draft)) },
    {
      tool: "submit_checks",
      arguments: {
        checks: visibleBullets(draft).map((bullet) => ({
          bulletId: bullet.id,
          verdict: "supported",
          reason: "Compared with outline",
        })),
      },
    },
  ]);
  closes.push(faux.close);
  if (!faux.models) throw new Error("Missing faux models");
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("faux"), log: "" });
  vi.spyOn(render, "pdfText").mockResolvedValue({
    pages: 1,
    text: visibleBullets(draft)
      .map((bullet) => bullet.text)
      .join("\n"),
  });
  const result = await generateBase(
    ws(),
    { name: "New direction" },
    { runtime: faux.runtime, models: faux.models, retry: { enabled: false } },
  );
  expect(visibleBullets(result.resume)[0]).toMatchObject({
    text: "Prepared clear records and shared reliable guidance.",
    claims: ["outline.summary"],
    locked: false,
    origin: "ai",
  });
  expect(visibleBullets(result.resume)[0]?.updatedFromSource).toBeUndefined();
});

it("migrates legacy section.text to an outline-cited summary instead of retaining old prose", async () => {
  const draft = structuredClone(resume);
  const section = required(draft.sections.find((section) => section.kind === "summary"));
  section.items = [];
  section.text = "An old uncited summary.";
  const result = await generate(draft, undefined, resume);
  expect(result.review.done).toBe(true);
  expect(result.resume.sections.find((section) => section.kind === "summary")?.text).toBeUndefined();
  expect(visibleBullets(result.resume)[0]).toMatchObject({
    text: "Prepared clear records and shared reliable guidance.",
    claims: ["outline.summary"],
  });
});

it("releases a lock when its outline section changes even if the cited claim text does not", async () => {
  await userEdit("a", "My earlier wording.");
  await writeTextAtomic(root, "outline.md", `${outline}\nUpdated context for this experience.\n`);
  await commit(3, ["outline.md"], "Update experience context");
  const draft = structuredClone(resume);
  required(visibleBullets(draft).find((bullet) => bullet.id === "a")).text = "Prepared the outline.";
  const result = await generate(draft);
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "a")).toMatchObject({
    text: "Prepared the outline.",
    origin: "ai",
    locked: false,
    updatedFromSource: { previousText: "My earlier wording." },
  });
});

it("keeps a local summary without creating a nonexistent outline.summary citation", async () => {
  await writeTextAtomic(
    root,
    "outline.md",
    outline.replace("## Professional Summary\nPrepared clear records and shared reliable guidance.\n", ""),
  );
  await commit(1, ["outline.md"], "Outline without summary");
  required(visibleBullets(resume).find((bullet) => bullet.id === "summary-bullet")).claims = ["outline-a"];
  await userEdit("summary-bullet", "My local summary.", 4);
  const result = await generate(resume);
  expect(result.review.done).toBe(true);
  expect(visibleBullets(result.resume)[0]).toMatchObject({
    text: "My local summary.",
    claims: ["outline-a"],
    origin: "user",
    locked: true,
  });
});

it("keeps a lock when an unrelated outline section changes", async () => {
  await userEdit("b", "My inventory wording.");
  await writeTextAtomic(root, "outline.md", outline.replace("Prepared the outline.", "Revised the outline."));
  await commit(3, ["outline.md"], "Update unrelated outline claim");
  const result = await generate(resume);
  expect(visibleBullets(result.resume).find((bullet) => bullet.id === "b")).toEqual(
    visibleBullets(resume).find((bullet) => bullet.id === "b"),
  );
});
