import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume, Review, visibleBullets } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as agent from "../agent/index.js";
import { createGenerationRuntime, FauxScript } from "../agent/roles.js";
import * as render from "../render/index.js";
import { commitPaths, ensureRepo, readText, writeTextAtomic } from "../workspace/index.js";
import { generateMaster } from "./master.js";
import { tailor } from "./tailor.js";
import { citeFixtureSummary, skipFixtureResults } from "./test-fixtures.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let resume: Resume;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-quality-pipeline-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  resume = citeFixtureSummary(Resume.parse(JSON.parse(await readText(root, "resumes/master/resume.json"))));
  await ensureRepo(root);
  await writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
  await commitPaths(root, ["."], "Fixture", "system");
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const checks = (value: Resume) =>
  visibleBullets(value).map((bullet) => ({ bulletId: bullet.id, verdict: "supported", reason: "Source supports it" }));
it("reviews after checks/render, revises once for a medium fix and saves the final score with usage", async () => {
  const revised = structuredClone(resume);
  revised.header.headline = "Service Coordinator";
  const finding = {
    id: "position",
    area: "positioning",
    severity: "medium",
    message: "Use a focused headline",
    fix: { ops: [{ op: "header.set", headline: "Service Coordinator" }] },
  };
  const created = await createGenerationRuntime(
    FauxScript.parse([
      { tool: "submit_resume", arguments: resume },
      { tool: "submit_checks", arguments: { checks: checks(resume) } },
      { tool: "submit_review", arguments: { score: 7, summary: "Focus the headline", findings: [finding] } },
      { tool: "submit_resume", arguments: revised },
      { tool: "submit_review", arguments: { score: 8, summary: "Clear positioning", findings: [finding] } },
    ]),
  );
  close = created.close;
  if (!created.models) throw new Error("Missing faux models");
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("PDF"), log: "" });
  vi.spyOn(render, "pdfText").mockResolvedValue({
    text: visibleBullets(resume)
      .map((b) => b.text)
      .join("\n"),
    pages: 1,
  });
  const spy = vi.spyOn(agent, "runRole");
  const progress: string[] = [];
  const result = await generateMaster(
    { root, bundledDir },
    {
      runtime: created.runtime,
      models: created.models,
      retry: { enabled: false },
      onProgress: (event) => progress.push(event.stage),
    },
  );
  expect(result.review.recruiter).toMatchObject({ score: 8, summary: "Clear positioning" });
  expect(result.resume.header.headline).toBe("Service Coordinator");
  expect(spy.mock.calls.filter(([opts]) => opts.role.name === "writer")).toHaveLength(2);
  expect(spy.mock.calls.filter(([opts]) => opts.role.name === "reviewer")).toHaveLength(2);
  expect(progress.indexOf("review")).toBeGreaterThan(progress.indexOf("check"));
  const revision = spy.mock.calls.filter(([opts]) => opts.role.name === "writer")[1]?.[0];
  expect(revision?.task).toContain("Use a focused headline");
  expect(Review.parse(JSON.parse(await readText(root, "resumes/master/review.json"))).recruiter?.score).toBe(8);
  const { parse } = await import("yaml");
  const usage = parse(await readText(root, "resumes/master/meta.yaml")).usage as { role: string }[];
  expect(usage.filter((entry) => entry.role === "reviewer")).toHaveLength(2);
  expect(usage.findIndex((entry) => entry.role === "reviewer")).toBeGreaterThan(
    usage.findIndex((entry) => entry.role === "checker"),
  );
});
it("puts selected missing dates in questions-first before writing, with at most six questions", async () => {
  await skipFixtureResults(root);
  const projects = await readText(root, "projects.md");
  const extras = Array.from(
    { length: 7 },
    (_, i) => `
## Archive ${String.fromCharCode(65 + i)}

\`\`\`yaml
kind: project
skipped: [results]
\`\`\`

### Claims
- Built an archive for volunteers. <!-- c:archive-${i} -->
`,
  ).join("");
  await writeTextAtomic(root, "projects.md", projects.replace('period: "2025–2026"\n', "") + extras);
  const created = await createGenerationRuntime([
    {
      tool: "submit_analysis",
      arguments: {
        title: "Archive Coordinator",
        requirements: [{ id: "archive", text: "Archive", importance: "must", keywords: [["archive"]] }],
        baseScores: [],
      },
    },
  ]);
  close = created.close;
  if (!created.models) throw new Error("Missing faux models");
  const spy = vi.spyOn(agent, "runRole");
  const result = await tailor(
    { root, bundledDir },
    { jobText: "Archive Coordinator", slug: "dates" },
    { runtime: created.runtime, models: created.models, retry: { enabled: false } },
  );
  expect(result.status).toBe("needs-answers");
  expect(result.review.gaps[0]).toMatch(/^dates\./);
  expect(result.review.gaps.length).toBe(6);
  const next = await tailor(
    { root, bundledDir },
    {
      jobText: "Archive Coordinator",
      applicationId: result.applicationDir.split("/")[1],
      answers: Object.fromEntries(result.review.gaps.map((gap) => [gap.slice(0, gap.indexOf(":")), "skip"])),
    },
    { runtime: created.runtime, models: created.models, retry: { enabled: false } },
  );
  expect(next.status).toBe("needs-answers");
  expect(next.review.gaps).toHaveLength(2);
  expect(next.review.gaps.some((gap) => result.review.gaps.includes(gap))).toBe(false);
  expect(spy.mock.calls.some(([opts]) => opts.role.name === "writer")).toBe(false);
});
it("asks new missing facts before regenerating an existing job and preserves its saved resume", async () => {
  const projects = await readText(root, "projects.md");
  await writeTextAtomic(root, "projects.md", projects.replace('period: "2025–2026"\n', ""));
  const stored = JSON.stringify({ ...resume, id: "existing", kind: "job" });
  await writeTextAtomic(root, "applications/existing/resume.json", stored);
  await writeTextAtomic(root, "applications/existing/meta.yaml", "createdAt: 2026-10-22\nbaseId: master\n");
  await writeTextAtomic(root, "applications/existing/job.md", "Archive Coordinator");
  await writeTextAtomic(
    root,
    "applications/existing/analysis.json",
    JSON.stringify({ title: "Archive Coordinator", requirements: [], baseScores: [] }),
  );
  const created = await createGenerationRuntime([]);
  close = created.close;
  if (!created.models) throw new Error("Missing faux models");
  const spy = vi.spyOn(agent, "runRole");
  const result = await tailor(
    { root, bundledDir },
    { jobText: "Archive Coordinator", applicationId: "existing" },
    { runtime: created.runtime, models: created.models, retry: { enabled: false } },
  );
  expect(result.status).toBe("needs-answers");
  expect(result.review.gaps.some((gap) => gap.startsWith("dates.community-archive:"))).toBe(true);
  expect(await readText(root, "applications/existing/resume.json")).toBe(stored);
  expect(spy).not.toHaveBeenCalled();
});
