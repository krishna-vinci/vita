import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { FactsAnswerResult, MissingFactsView, PreviewResult, Review } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let runtime: WorkspaceRuntime;
let close: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-quality-route-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  const created = await core.createGenerationRuntime([]);
  close = created.close;
  runtime = await WorkspaceRuntime.create({ root, bundledDir, runtime: created.runtime, models: created.models });
});
afterEach(async () => {
  await runtime.close();
  await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const post = (value: unknown = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

it("previews unchecked content and caches by resume, layout, template and patch without any commit or certification", async () => {
  const compile = vi.spyOn(core, "compileTex").mockResolvedValue({ pdf: Buffer.from("preview PDF"), log: "" });
  const app = createWorkspaceApp(runtime);
  const history = await core.log(root, 10);
  const reviewBefore = await runtime.optional("resumes/master/review.json");
  const preview = async () => {
    const response = await app.request("/api/resumes/master/preview", post());
    expect(response.status, await response.clone().text()).toBe(200);
    return PreviewResult.parse(await response.json()).url;
  };
  const initial = await preview();
  expect(await preview()).toBe(initial);
  expect(compile).toHaveBeenCalledTimes(1);
  const response = await app.request(initial);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(await response.text()).toBe("preview PDF");
  const resource = await runtime.resource("resume", "master");
  resource.resume.layout.font_pt = 11;
  await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resource.resume));
  expect(await preview()).not.toBe(initial);
  const template = await runtime.template(resource.resume.template);
  const view = await core.renderStoredTex(root, resource.resume, template, await core.loadRenderSources(root), false);
  await core.writeTextAtomic(
    root,
    "resumes/master/tex.patch",
    core.createTexPatch(view.generated, view.generated.replace("\\end{document}", "\\vspace{1pt}\n\\end{document}")),
  );
  const patched = await preview();
  expect(compile).toHaveBeenLastCalledWith(expect.objectContaining({ tex: expect.stringContaining("\\vspace{1pt}") }));
  await cp(template.dir, join(root, "templates", template.meta.id), { recursive: true });
  await core.writeTextAtomic(
    root,
    `templates/${template.meta.id}/main.tex.njk`,
    `${await core.readText(root, `templates/${template.meta.id}/main.tex.njk`)}\n% Preview template change\n`,
  );
  expect(await preview()).not.toBe(patched);
  expect(compile).toHaveBeenCalledTimes(4);
  expect(await core.log(root, 10)).toEqual(history);
  expect(await runtime.optional("resumes/master/review.json")).toBe(reviewBefore);
  expect(await runtime.optional("resumes/master/tex.conflict.json")).toBeUndefined();
});

it("confines preview GETs and rejects a cache symlink escape", async () => {
  vi.spyOn(core, "compileTex").mockResolvedValue({ pdf: Buffer.from("PDF"), log: "" });
  const app = createWorkspaceApp(runtime);
  const { url } = PreviewResult.parse(await (await app.request("/api/resumes/master/preview", post())).json());
  expect((await app.request("/api/preview/not-a-hash.pdf")).status).toBe(403);
  const hash = /([a-f0-9]{64})/.exec(url)?.[1];
  if (!hash) throw new Error("Missing preview hash");
  for (const target of [join(root, "outline.md"), "/etc/passwd"]) {
    await rm(join(root, ".vita/preview", `${hash}.pdf`));
    await symlink(target, join(root, ".vita/preview", `${hash}.pdf`));
    expect((await app.request(url)).status).toBe(403);
  }
});

it("applies recruiter ops through the undoable normal path and routes question findings to missing facts", async () => {
  const app = createWorkspaceApp(runtime);
  const resource = await runtime.resource("resume", "master");
  const headline = resource.resume.header.headline;
  const review = Review.parse({
    round: 1,
    lint: [],
    checks: [],
    ats: [],
    render: null,
    gaps: [],
    overrides: [],
    done: false,
    blocking: [],
    recruiter: {
      score: 7,
      summary: "Needs focus",
      findings: [
        {
          id: "general",
          area: "positioning",
          severity: "low",
          message: "Ask about preferences",
          fix: { question: { id: "work-preference", kind: "other", text: "What work pattern do you prefer?" } },
        },
        {
          id: "headline",
          area: "positioning",
          severity: "medium",
          message: "Focus headline",
          fix: { ops: [{ op: "header.set", headline: "Service Coordinator" }] },
        },
        {
          id: "result",
          area: "results",
          severity: "medium",
          message: "Share a result",
          fix: {
            question: {
              id: "results.community-archive",
              kind: "results",
              text: "Who uses the archive?",
            },
          },
        },
      ],
    },
  });
  await core.writeTextAtomic(root, "resumes/master/review.json", JSON.stringify(review));
  await core.commitPaths(root, ["resumes/master/review.json"], "Reviewed fixture", "writer");
  const applied = await app.request("/api/resumes/master/review/headline/apply", post());
  expect(applied.status, await applied.clone().text()).toBe(200);
  expect((await runtime.resource("resume", "master")).resume.header.headline).toBe("Service Coordinator");
  const undo = await app.request("/api/undo", post({ scope: "resume", id: "master" }));
  expect(undo.status, await undo.clone().text()).toBe(200);
  expect((await runtime.resource("resume", "master")).resume.header.headline).toBe(headline);
  const question = await app.request("/api/resumes/master/review/result/apply", post());
  expect(question.status).toBe(409);
  expect(await question.json()).toMatchObject({
    error: { code: "answer-required", details: { question: { id: "results.community-archive" } } },
  });
  const missing = MissingFactsView.parse(await (await app.request("/api/facts/missing")).json());
  expect(missing.questions.map((q) => q.id)).toContain("results.community-archive");
  const answered = await app.request(
    "/api/facts/answer",
    post({
      answers: {
        "results.community-archive": "Used by local volunteers every week",
        "work-preference": "I prefer collaborative work with regular feedback",
      },
    }),
  );
  expect(answered.status, await answered.clone().text()).toBe(200);
  expect(
    FactsAnswerResult.parse(await answered.json()).questions.some((q) => q.id === "results.community-archive"),
  ).toBe(false);
  expect(await core.readText(root, "outline.md")).toContain("## Additional facts");
  expect(await core.readText(root, "outline.md")).toContain("I prefer collaborative work with regular feedback");
  await core.writeTextAtomic(
    root,
    "applications/existing/resume.json",
    JSON.stringify({ ...resource.resume, id: "existing", kind: "job" }),
  );
  await core.writeTextAtomic(
    root,
    "applications/existing/analysis.json",
    JSON.stringify({ title: "Example", requirements: [], baseScores: [] }),
  );
  await core.writeTextAtomic(root, "applications/existing/job.md", "Example role");
  await core.writeTextAtomic(root, "applications/existing/meta.yaml", "status: needs-answers\n");
  expect(await runtime.application("existing")).toMatchObject({ status: "needs-answers", resume: { id: "existing" } });
});
